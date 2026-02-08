require('dotenv').config();
const { Telegraf } = require('telegraf');
const Database = require('better-sqlite3');

// Kiểm tra Key
if (!process.env.GROQ_API_KEY) {
    console.error('⛔ LỖI: Chưa có GROQ_API_KEY trong file .env');
    process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// ID Admin và Group để nhận thông báo (từ .env)
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const GROUP_ID = parseInt(process.env.GROUP_ID);

// ==================== SQLITE MEMORY ====================
const db = new Database('memory.db');

// Bảng lưu lịch sử chat của từng user (không giới hạn)
db.exec(`
    CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        username TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Bảng lưu danh sách khách đã chat (để broadcast)
db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
        chat_id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Tạo index
db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_id ON chat_history(chat_id)`);

// Bảng lưu kiến thức từ Admin (dùng để dạy Bot)
db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Số tin nhắn gần nhất để gửi cho AI
const CONTEXT_LIMIT = 50;

// Lưu kiến thức từ Admin
function saveKnowledge(content) {
    const stmt = db.prepare('INSERT INTO knowledge (content) VALUES (?)');
    stmt.run(content);
}

// Lấy tất cả kiến thức đã học
function getAllKnowledge(limit = 30) {
    const stmt = db.prepare('SELECT content FROM knowledge ORDER BY id DESC LIMIT ?');
    return stmt.all(limit).reverse();
}

// Đếm số kiến thức
function countKnowledge() {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM knowledge');
    return stmt.get().count;
}

// Lưu/cập nhật thông tin khách
function saveCustomer(chatId, username, firstName) {
    const stmt = db.prepare(`
        INSERT INTO customers (chat_id, username, first_name, last_seen) 
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(chat_id) DO UPDATE SET 
            username = excluded.username,
            first_name = excluded.first_name,
            last_seen = CURRENT_TIMESTAMP
    `);
    stmt.run(chatId, username, firstName);
}

// Lấy danh sách tất cả khách
function getAllCustomers() {
    const stmt = db.prepare('SELECT chat_id, username, first_name FROM customers');
    return stmt.all();
}

// Đếm số khách
function countCustomers() {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM customers');
    return stmt.get().count;
}

// Lưu tin nhắn vào database
function saveMessage(chatId, username, role, content) {
    const stmt = db.prepare('INSERT INTO chat_history (chat_id, username, role, content) VALUES (?, ?, ?, ?)');
    stmt.run(chatId, username, role, content);
}

// Lấy lịch sử chat gần nhất của user
function getChatHistory(chatId, limit = CONTEXT_LIMIT) {
    const stmt = db.prepare(`
        SELECT role, content FROM chat_history 
        WHERE chat_id = ? 
        ORDER BY id DESC 
        LIMIT ?
    `);
    const rows = stmt.all(chatId, limit);
    return rows.reverse();
}

console.log('🧠 SQLite Memory đã sẵn sàng!');
console.log(`👥 Số khách đã chat: ${countCustomers()}`);
// ==================== END MEMORY ====================

// Lưu mapping để reply ngược lại khách
const customerChats = new Map();

// Load data from JSON
const fs = require('fs');
let botData = {};
try {
    const rawData = fs.readFileSync('data.json', 'utf8');
    botData = JSON.parse(rawData);
    console.log('📖 Đã tải dữ liệu từ data.json');
} catch (error) {
    console.error('Lỗi đọc file data.json:', error);
}

// Hàm cập nhật System Prompt từ data
function getSystemPrompt() {
    if (!botData.systemprompt_intro) return '';

    let prompt = botData.systemprompt_intro + '\n\n';

    // Inject kiến thức từ Admin đã dạy
    const knowledge = getAllKnowledge(30);
    if (knowledge.length > 0) {
        prompt += '=== KIẾN THỨC BỔ SUNG TỪ ADMIN (Hãy ưu tiên sử dụng thông tin này) ===\n';
        knowledge.forEach(k => prompt += `- ${k.content}\n`);
        prompt += '=== HẾT KIẾN THỨC BỔ SUNG ===\n\n';
    }

    if (botData.services) {
        prompt += 'Dịch vụ và Bảng giá VPS:\n';
        botData.services.forEach((s, i) => {
            prompt += `${i + 1}. ${s.name}: ${s.specs} - ${s.price}\n`;
            if (s.promotion) prompt += `   * Khuyến mãi: ${s.promotion}\n`;
        });
        prompt += '\n';
    }

    if (botData.addons) {
        prompt += 'Dịch vụ Addon:\n';
        botData.addons.forEach(a => prompt += `- ${a.name}: ${a.price}\n`);
        prompt += '\n';
    }

    if (botData.os_support) {
        prompt += `Hệ điều hành hỗ trợ: ${botData.os_support}\n\n`;
    }

    if (botData.contacts) {
        prompt += 'Liên hệ:\n';
        for (const [key, value] of Object.entries(botData.contacts)) {
            prompt += `- ${key}: ${value}\n`;
        }
    }

    return prompt;
}

// System Prompt sẽ được gọi động mỗi lần chat (để lấy knowledge mới nhất)

// Từ khóa khẩn cấp (Lấy từ data hoặc default)
const URGENT_KEYWORDS = botData.urgent_keywords || ['gấp', 'khẩn cấp', 'sập', 'down', 'không vào được', 'lỗi nghiêm trọng', 'mất dữ liệu', 'bị hack', 'ddos', 'tấn công'];

// Hàm gọi Groq API với lịch sử chat
async function callGroq(chatId, username, userMessage) {
    const apiKey = process.env.GROQ_API_KEY;
    const url = 'https://api.groq.com/openai/v1/chat/completions';

    const history = getChatHistory(chatId);

    const messages = [
        { role: "system", content: getSystemPrompt() }, // Gọi động để lấy knowledge mới nhất
        ...history,
        { role: "user", content: userMessage }
    ];

    const requestBody = {
        model: "llama-3.3-70b-versatile",
        messages: messages,
        max_tokens: 1024,
        temperature: 0.8
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("API Error Response:", JSON.stringify(data, null, 2));
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        if (data.choices && data.choices[0] && data.choices[0].message) {
            const aiResponse = data.choices[0].message.content;

            saveMessage(chatId, username, 'user', userMessage);
            saveMessage(chatId, username, 'assistant', aiResponse);

            return aiResponse;
        } else {
            return "Xin lỗi bạn, mình chưa hiểu ý bạn lắm. Bạn có thể nói rõ hơn được không?";
        }

    } catch (error) {
        console.error("Fetch Error:", error);
        throw error;
    }
}

// Hàm kiểm tra tin nhắn khẩn cấp
function isUrgent(text) {
    const lowerText = text.toLowerCase();
    return URGENT_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

// Hàm gửi thông báo đến Group
async function notifyGroup(ctx, isUrgent = false) {
    try {
        const user = ctx.from;
        const username = user.username ? `@${user.username}` : user.first_name;
        const urgentTag = isUrgent ? '🚨 *KHẨN CẤP* 🚨\n' : '';

        const notification = `${urgentTag}📩 *Tin nhắn từ khách*
👤 Khách: ${username} (ID: ${user.id})
💬 Nội dung: ${ctx.message.text}

_Reply tin nhắn này để trả lời khách_`;

        const sentMsg = await bot.telegram.sendMessage(GROUP_ID, notification, {
            parse_mode: 'Markdown'
        });

        customerChats.set(sentMsg.message_id, {
            chatId: ctx.chat.id,
            username: username
        });

    } catch (error) {
        console.error("Lỗi gửi thông báo đến group:", error);
    }
}

// Trạng thái của Bot
const chatStates = new Map();
const autoResumeTimers = new Map(); // Lưu timer tự động bật lại Bot

function getChatState(chatId) {
    if (!chatStates.has(chatId)) {
        chatStates.set(chatId, { isPaused: false });
    }
    return chatStates.get(chatId);
}

// Hàm tự động bật lại Bot sau 1 giờ
function scheduleAutoResume(chatId) {
    // Xóa timer cũ nếu có
    if (autoResumeTimers.has(chatId)) {
        clearTimeout(autoResumeTimers.get(chatId));
    }

    // Đặt timer mới - 1 giờ = 3600000ms
    const timer = setTimeout(async () => {
        const state = getChatState(chatId);
        if (state.isPaused) {
            state.isPaused = false;
            try {
                await bot.telegram.sendMessage(chatId, '🤖 Bot đã tự động bật lại sau 1 giờ.\nNếu bạn cần nhân viên hỗ trợ tiếp, hãy dùng lệnh /lienhesupport');
                console.log(`⏰ Auto-resume cho chat ${chatId}`);
            } catch (error) {
                console.error('Lỗi auto-resume:', error.message);
            }
        }
        autoResumeTimers.delete(chatId);
    }, 60 * 60 * 1000); // 1 giờ

    autoResumeTimers.set(chatId, timer);
}

// Lệnh /start
// Lệnh /start
bot.start((ctx) => {
    // Lưu thông tin khách
    saveCustomer(ctx.chat.id, ctx.from.username, ctx.from.first_name);

    ctx.reply('Chào bạn! 👋\nMình là trợ lý hỗ trợ của H2Cloud.\nBạn cần mình giúp gì ạ?', {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '💰 Bảng Giá VPS', callback_data: 'price_vps' },
                    { text: '📚 Hướng dẫn', callback_data: 'guide' }
                ],
                [
                    { text: '📞 Liên hệ Support', callback_data: 'contact_support' },
                    { text: '🌐 Website', url: 'https://h2cloud.vn' }
                ]
            ]
        }
    });
});

// Xử lý nút bấm
bot.action('price_vps', async (ctx) => {
    let msg = '*Bảng giá VPS H2Cloud:*\n\n';
    if (botData.services) {
        botData.services.forEach((s, i) => {
            msg += `${i + 1}. *${s.name}*: ${s.specs}\n   💵 Giá: ${s.price}\n`;
            if (s.promotion) msg += `   🎁 _${s.promotion}_\n`;
            msg += '\n';
        });
    }
    msg += `👉 [Xem chi tiết trên Website](${botData.contacts.website})`;

    // Sửa tin nhắn cũ thay vì gửi tin mới (tránh spam)
    try {
        await ctx.editMessageText(msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
        // Hiện lại menu sau khi xem xong (tùy chọn, ở đây mình gửi thêm 1 tin menu mới hoặc nút Back)
        await ctx.reply('Bạn cần hỗ trợ gì thêm không?', {
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Quay lại Menu', callback_data: 'back_to_menu' }]]
            }
        });
    } catch (e) {
        ctx.reply(msg, { parse_mode: 'Markdown' });
    }
});

bot.action('guide', async (ctx) => {
    const guideMsg = `📚 *Hướng dẫn sử dụng Bot*
    
• *Tra cứu giá:* Nhấn nút "Bảng Giá VPS"
• *Hỗ trợ:* Nhấn "Liên hệ Support" để gặp nhân viên
• *Chat AI:* Chỉ cần nhắn tin bình thường, Bot sẽ trả lời
• *Lệnh:* /start (Menu), /thongbao (Admin)

Cần giúp đỡ gấp? Gọi ngay Hotline hoặc nhắn vào nhóm Telegram.`;

    try {
        await ctx.editMessageText(guideMsg, { parse_mode: 'Markdown' });
        await ctx.reply('Bạn cần hỗ trợ gì thêm không?', {
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Quay lại Menu', callback_data: 'back_to_menu' }]]
            }
        });
    } catch (e) {
        ctx.reply(guideMsg, { parse_mode: 'Markdown' });
    }
});

bot.action('contact_support', (ctx) => {
    ctx.reply('Bạn đã chọn gặp nhân viên hỗ trợ. Vui lòng chờ giây lát...', {
        reply_markup: {
            inline_keyboard: [[{ text: '🔙 Quay lại Menu', callback_data: 'back_to_menu' }]]
        }
    });
    // Gọi hàm xử lý support (giống lệnh /lienhesupport)
    handleSupportRequest(ctx);
});

bot.action('back_to_menu', async (ctx) => {
    try {
        await ctx.deleteMessage(); // Xóa tin nhắn "Quay lại"
        await ctx.reply('Chào bạn! 👋\nMình là trợ lý hỗ trợ của H2Cloud.\nBạn cần mình giúp gì ạ?', {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '💰 Bảng Giá VPS', callback_data: 'price_vps' },
                        { text: '📚 Hướng dẫn', callback_data: 'guide' }
                    ],
                    [
                        { text: '📞 Liên hệ Support', callback_data: 'contact_support' },
                        { text: '🌐 Website', url: 'https://h2cloud.vn' }
                    ]
                ]
            }
        });
    } catch (e) {
        // Fallback nếu không xóa được
        ctx.reply('Menu chính:', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💰 Bảng Giá VPS', callback_data: 'price_vps' }, { text: '📚 Hướng dẫn', callback_data: 'guide' }],
                    [{ text: '📞 Liên hệ Support', callback_data: 'contact_support' }, { text: '🌐 Website', url: 'https://h2cloud.vn' }]
                ]
            }
        });
    }
});

// Xử lý Check IP
bot.action('check_ip_request', (ctx) => {
    ctx.reply('🔍 Vui lòng nhập địa chỉ IP hoặc Domain bạn muốn kiểm tra.\nVí dụ: 103.1.2.3 hoặc google.com', {
        reply_markup: {
            force_reply: true // Bắt buộc reply tin nhắn này để bot biết đang check IP
        }
    });
});

// Hàm check IP qua API check-host.net
async function checkHost(target) {
    try {
        const response = await fetch(`https://check-host.net/check-ping?host=${target}&max_nodes=3`, {
            headers: { 'Accept': 'application/json' }
        });
        const data = await response.json();

        if (data.request_id) {
            return `🚀 Đang kiểm tra ${target}...\n👉 Xem kết quả chi tiết tại đây: https://check-host.net/check-ping?host=${target}`;
        }
        return "⚠️ Không thể kiểm tra lúc này.";
    } catch (error) {
        return "❌ Lỗi kết nối đến server check.";
    }
}

// Tách hàm xử lý support để dùng chung cho cả lệnh và nút bấm
async function handleSupportRequest(ctx) {
    const state = getChatState(ctx.chat.id);
    state.isPaused = true;
    scheduleAutoResume(ctx.chat.id);

    ctx.reply('✋ Dạ, mình đã ghi nhận yêu cầu.\nNhân viên hỗ trợ sẽ vào chat trực tiếp với bạn ngay ạ!\n\n_(Bot tạm dừng 1 giờ, nhân viên sẽ phản hồi)_', { parse_mode: 'Markdown' });

    const user = ctx.from;
    const username = user.username ? `@${user.username}` : user.first_name;
    await bot.telegram.sendMessage(GROUP_ID, `🔔 *Khách yêu cầu hỗ trợ trực tiếp*\n👤 Khách: ${username} (ID: ${user.id})\n\n_Hãy liên hệ khách ngay!_`, { parse_mode: 'Markdown' });
}

// Lệnh /huongdan
bot.command('huongdan', (ctx) => {
    ctx.reply(`📚 *Hướng dẫn sử dụng Bot*

Bạn có thể hỏi mình bất cứ điều gì về dịch vụ của H2Cloud:
• Thông tin VPS, Cloud Server
• Hướng dẫn sử dụng
• Báo lỗi, sự cố kỹ thuật
• Thắc mắc về thanh toán

*Các lệnh hỗ trợ:*
/huongdan - Xem hướng dẫn này
/lienhesupport - Yêu cầu nhân viên thật hỗ trợ
/chatvoibot - Để Bot tiếp tục hỗ trợ tự động

*Liên hệ Đội ngũ H2Cloud:*
📧 Email: admin@h2cloud.vn
🎫 Tạo ticket: https://kvm.h2cloud.vn/submitticket.php
👥 Nhóm Telegram: https://t.me/h2cloud\\_vn
💬 Hỗ trợ trực tiếp: https://t.me/sph2vn`, { parse_mode: 'Markdown' });
});

// Lệnh /thongbao - Chỉ ADMIN dùng được, gửi thông báo đến tất cả khách
bot.command('thongbao', async (ctx) => {
    // Kiểm tra quyền Admin
    if (ctx.from.id !== ADMIN_ID) {
        return ctx.reply('⛔ Bạn không có quyền sử dụng lệnh này.');
    }

    // Lấy nội dung thông báo
    const message = ctx.message.text.replace('/thongbao', '').trim();

    if (!message) {
        return ctx.reply('� Cách dùng: /thongbao <nội dung thông báo>\n\nVí dụ: /thongbao Hệ thống sẽ bảo trì từ 22h-23h hôm nay.');
    }

    const customers = getAllCustomers();
    let successCount = 0;
    let failCount = 0;

    await ctx.reply(`📢 Đang gửi thông báo đến ${customers.length} khách...`);

    for (const customer of customers) {
        try {
            await bot.telegram.sendMessage(customer.chat_id, `� *Thông báo từ H2Cloud*\n\n${message}`, { parse_mode: 'Markdown' });
            successCount++;
            // Delay nhỏ để tránh bị rate limit
            await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error) {
            console.error(`Lỗi gửi đến ${customer.chat_id}:`, error.message);
            failCount++;
        }
    }

    ctx.reply(`✅ Đã gửi thông báo!\n\n📊 Thống kê:\n- Thành công: ${successCount}\n- Thất bại: ${failCount}`);
});

// Lệnh /thongke - Xem thống kê (chỉ ADMIN)
bot.command('thongke', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) {
        return ctx.reply('⛔ Bạn không có quyền sử dụng lệnh này.');
    }

    const customerCount = countCustomers();
    const messageCount = db.prepare('SELECT COUNT(*) as count FROM chat_history').get().count;

    ctx.reply(`📊 *Thống kê Bot*\n\n👥 Số khách đã chat: ${customerCount}\n💬 Tổng số tin nhắn: ${messageCount}`, { parse_mode: 'Markdown' });
});

// Lệnh /lienhesupport
bot.command('lienhesupport', async (ctx) => {
    handleSupportRequest(ctx);
});

// Lệnh /chatvoibot
bot.command('chatvoibot', (ctx) => {
    const state = getChatState(ctx.chat.id);
    state.isPaused = false;
    ctx.reply('🤖 Bot đã sẵn sàng hỗ trợ bạn tiếp ạ!\nBạn cần mình giúp gì nữa không?');
});

// Xử lý tin nhắn
bot.on('text', async (ctx) => {
    // Reply từ Group
    if (ctx.chat.id === GROUP_ID && ctx.message.reply_to_message) {
        const replyToId = ctx.message.reply_to_message.message_id;
        const customerInfo = customerChats.get(replyToId);

        if (customerInfo) {
            try {
                await bot.telegram.sendMessage(customerInfo.chatId, ctx.message.text);
                await ctx.reply(`✅ Đã gửi đến ${customerInfo.username}`);
            } catch (error) {
                await ctx.reply(`❌ Lỗi gửi tin nhắn: ${error.message}`);
            }
            return;
        }
    }

    if (ctx.chat.id === GROUP_ID) return;

    // Kiểm tra xem khách có đang reply tin nhắn hỏi IP không
    if (ctx.message.reply_to_message &&
        ctx.message.reply_to_message.text.includes('Vui lòng nhập địa chỉ IP')) {
        const target = ctx.message.text.trim();
        // Validate sơ bộ
        if (!/^[a-zA-Z0-9.-]+$/.test(target)) {
            return ctx.reply('⛔ Địa chỉ không hợp lệ. Vui lòng thử lại.');
        }
        const result = await checkHost(target);
        return ctx.reply(result);
    }

    const user = ctx.from;
    const username = user.username ? `@${user.username}` : user.first_name;

    const isAdminPrivate = ctx.from.id === ADMIN_ID && ctx.chat.type === 'private';

    // ========== XỬ LÝ ADMIN DẠY BOT ==========
    if (isAdminPrivate) {
        const msgText = ctx.message.text;
        // Tự động lưu kiến thức nếu không phải lệnh
        if (!msgText.startsWith('/')) {
            saveKnowledge(msgText);
            console.log(`📚 [Admin dạy Bot]: ${msgText}`);
        }
        // Admin chat riêng sẽ KHÔNG gửi vào Group, nhưng vẫn chạy tiếp xuống AI để trả lời
    } else {
        // Chỉ khách hàng mới lưu thông tin và gửi vào Group
        saveCustomer(ctx.chat.id, user.username, user.first_name);
        await notifyGroup(ctx, isUrgent(ctx.message.text));
    }
    // ========== HẾT XỬ LÝ ADMIN ==========

    console.log(`📩 [${username}]: ${ctx.message.text}`);

    const state = getChatState(ctx.chat.id);
    const urgent = !isAdminPrivate && isUrgent(ctx.message.text);

    if (state.isPaused && !isAdminPrivate) return;

    if (urgent) {
        await bot.telegram.sendMessage(ADMIN_ID, `🚨 *TIN KHẨN CẤP*\n👤 Khách: ${username}\n💬 ${ctx.message.text}`, { parse_mode: 'Markdown' });
    }

    try {
        await ctx.sendChatAction('typing');

        const aiMsg = await callGroq(ctx.chat.id, username, ctx.message.text);

        if (aiMsg.length > 4000) {
            const chunks = aiMsg.match(/.{1,4000}/g) || [];
            for (const chunk of chunks) {
                await ctx.reply(chunk, { parse_mode: 'Markdown' });
            }
        } else {
            await ctx.reply(aiMsg, { parse_mode: 'Markdown' });
        }

    } catch (error) {
        console.error("Lỗi xử lý tin nhắn");
        ctx.reply('Xin lỗi bạn, hiện tại mình đang gặp chút trục trặc.\nBạn có thể dùng lệnh /lienhesupport để nhân viên hỗ trợ trực tiếp nhé!');
    }
});

bot.launch().then(() => {
    console.log('🚀 Bot H2Cloud Support đang chạy...');
    console.log('📢 Thông báo sẽ được gửi đến Group:', GROUP_ID);
});

// Xử lý dừng an toàn
process.once('SIGINT', () => {
    db.close();
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    db.close();
    bot.stop('SIGTERM');
});
