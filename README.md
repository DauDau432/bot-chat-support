# H2Cloud Telegram Support Bot

Đây là một Bot Telegram tự động hỗ trợ khách hàng cho dịch vụ VPS/Cloud Server H2Cloud. Bot sử dụng AI (thông qua Groq API) để trả lời các câu hỏi thường gặp, báo cáo sự cố, và hỗ trợ khách hàng liên hệ với nhân viên.

## Chức năng chính

*   **Tự động trả lời:** Trả lời các câu hỏi về giá cả, cấu hình VPS, hướng dẫn sử dụng, v.v. bằng tiếng Việt tự nhiên.
*   **Ghi nhớ ngữ cảnh:** Có khả năng nhớ lịch sử chat trong phiên làm việc để trả lời liên tục và mạch lạc.
*   **Chuyển giao cho nhân viên:** Khách hàng có thể yêu cầu gặp nhân viên hỗ trợ (`/lienhesupport`). Bot sẽ tạm dừng trả lời tự động trong 1 giờ để nhân viên chat trực tiếp.
*   **Thông báo khẩn cấp:** Tự động phát hiện các từ khóa khẩn cấp (vd: "sập", "lỗi", "gấp") và báo ngay cho Admin/Group.
*   **Gửi thông báo hàng loạt:** Admin có thể gửi thông báo đến tất cả khách hàng đã từng chat với Bot (`/thongbao`).
*   **Thống kê:** Xem số lượng khách hàng và tin nhắn (`/thongke`).

## Cài đặt và Chạy Bot

### Yêu cầu
*   Node.js (v14 trở lên)
*   Tài khoản Telegram Bot (lấy Token từ @BotFather)
*   Tài khoản Groq Cloud (lấy API Key)

### Các bước cài đặt

1.  **Clone repository về máy:**
    ```bash
    git clone https://github.com/DauDau432/bot-chat-support.git
    cd bot-chat-support
    ```

2.  **Cài đặt các thư viện cần thiết:**
    ```bash
    npm install
    ```

3.  **Cấu hình biến môi trường:**
    *   Copy file `.env.example` thành `.env`:
        ```bash
        cp .env.example .env
        ```
    *   Mở file `.env` và điền các thông tin:
        *   `BOT_TOKEN`: Token của Bot Telegram.
        *   `GROQ_API_KEY`: API Key từ Groq Cloud.
        *   `ADMIN_ID`: ID Telegram của Admin (người quản lý bot).
        *   `GROUP_ID`: ID của Group Telegram để nhận thông báo từ Bot.

4.  **Chạy Bot:**
    ```bash
    node index.js
    ```
    Hoặc dùng pm2 để chạy background:
    ```bash
    pm2 start index.js --name "h2cloud-bot"
    ```

## Cấu trúc thư mục

*   `index.js`: Mã nguồn chính của Bot.
*   `memory.db`: Database SQLite (tự động tạo) lưu lịch sử chat và thông tin khách hàng.
*   `.env`: File chứa biến môi trường (không được public).

## Đóng góp
Mọi đóng góp, báo lỗi vui lòng tạo Issue hoặc Pull Request trên GitHub.
