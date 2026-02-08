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

// Số tin nhắn gần nhất để gửi cho AI
const CONTEXT_LIMIT = 50;

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

// Từ khóa khẩn cấp
const URGENT_KEYWORDS = ['gấp', 'khẩn cấp', 'sập', 'down', 'không vào được', 'lỗi nghiêm trọng', 'mất dữ liệu', 'bị hack', 'ddos', 'tấn công'];

// System prompt
const SYSTEM_PROMPT = `Bạn là nhân viên hỗ trợ khách hàng của H2Cloud - công ty cung cấp dịch vụ VPS và Cloud Server tại Việt Nam.

Quy tắc trả lời:
- Luôn trả lời bằng tiếng Việt, thân thiện và chuyên nghiệp.
- Xưng hô: "mình" hoặc "bên mình", gọi khách là "bạn" hoặc "anh/chị".
- Trình bày thông tin gọn gàng, đẹp mắt. Sử dụng tiêu đề in đậm cho tên gói và dấu \`*\` cho thông số kỹ thuật (giống mẫu: **PLATIUM (1-1-20)**).
- Tránh viết quá nhiều dòng trống hoặc dấu gạch đầu dòng dư thừa. Cố gắng để thông tin hiển thị súc tích trên một màn hình điện thoại.
- LUÔN kết thúc bằng việc nhắc khách truy cập website https://h2cloud.vn để xem bảng giá đầy đủ và đăng ký.
- Trả lời đúng trọng tâm. Bạn CÓ KHẢ NĂNG NHỚ cuộc trò chuyện trước đó.

Dịch vụ và Bảng giá VPS PLATIUM (SSD, Băng thông không giới hạn, 1 IPv4 riêng):
1. PLATIUM (1-1-20): 1 Core CPU, 1GB RAM, 20GB SSD - 40.000 VNĐ/tháng
2. PLATIUM (2-2-30): 2 Core CPU, 2GB RAM, 30GB SSD - 60.000 VNĐ/tháng
3. PLATIUM (4-4-40): 4 Core CPU, 4GB RAM, 40GB SSD - 150.000 VNĐ/tháng
4. PLATIUM (6-6-80): 6 Core CPU, 6GB RAM, 80GB SSD - 250.000 VNĐ/tháng
5. PLATIUM ULTIMATE (18-30-240): 18 Core CPU, 30GB RAM, 240GB SSD - 1.100.000 VNĐ/tháng
* Khuyến mãi: PLATIUM (6-6-80) Sale 1 năm chỉ 980.000 VNĐ.

Dịch vụ Addon VPS:
- Thêm 1 Core CPU: 25.000 VNĐ/tháng
- Thêm 1GB RAM: 35.000 VNĐ/tháng
- Thêm 10GB SSD: 20.000 VNĐ/tháng

Hệ điều hành hỗ trợ: Windows (2012, 2016, 2019, 2022, Win 10) và Linux (Ubuntu, CentOS, Debian).

Liên hệ và Trang web:
- Trang chủ: https://h2cloud.vn
- Đăng ký dịch vụ: https://cloudserver.h2cloud.vn hoặc https://kvm.h2cloud.vn
- Email: admin@h2cloud.vn
- Tạo ticket: https://kvm.h2cloud.vn/submitticket.php
- Nhóm Telegram: https://t.me/h2cloud_vn
- Hỗ trợ trực tiếp: https://t.me/sph2vn`;

// Hàm gọi Groq API với lịch sử chat
async function callGroq(chatId, username, userMessage) {
    const apiKey = process.env.GROQ_API_KEY;
    const url = 'https://api.groq.com/openai/v1/chat/completions';

    const history = getChatHistory(chatId);

    const messages = [
        { role: "system", content: SYSTEM_PROMPT },
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
bot.start((ctx) => {
    // Lưu thông tin khách
    saveCustomer(ctx.chat.id, ctx.from.username, ctx.from.first_name);
    ctx.reply('Chào bạn! 👋\nMình là trợ lý hỗ trợ của H2Cloud.\nBạn cần mình giúp gì ạ?');
});

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
    const state = getChatState(ctx.chat.id);
    state.isPaused = true;

    // Đặt timer tự động bật lại sau 1 giờ
    scheduleAutoResume(ctx.chat.id);

    ctx.reply('✋ Dạ, mình đã ghi nhận yêu cầu.\nNhân viên hỗ trợ sẽ vào chat trực tiếp với bạn ngay ạ!\n\n_(Bot tạm dừng 1 giờ, nhân viên sẽ phản hồi)_', { parse_mode: 'Markdown' });

    const user = ctx.from;
    const username = user.username ? `@${user.username}` : user.first_name;
    await bot.telegram.sendMessage(GROUP_ID, `🔔 *Khách yêu cầu hỗ trợ trực tiếp*\n👤 Khách: ${username} (ID: ${user.id})\n\n_Hãy liên hệ khách ngay!_`, { parse_mode: 'Markdown' });
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

    const user = ctx.from;
    const username = user.username ? `@${user.username}` : user.first_name;

    // Lưu thông tin khách
    saveCustomer(ctx.chat.id, user.username, user.first_name);

    console.log(`📩 [${username}]: ${ctx.message.text}`);

    const state = getChatState(ctx.chat.id);
    const urgent = isUrgent(ctx.message.text);

    await notifyGroup(ctx, urgent);

    if (state.isPaused) return;

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
