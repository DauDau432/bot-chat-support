# H2Cloud Telegram Support Bot

Đây là một Bot Telegram tự động hỗ trợ khách hàng chuyên nghiệp cho dịch vụ VPS/Cloud Server H2Cloud. Bot tích hợp AI (Groq API) và hệ thống ghi nhớ kiến thức tự động để phản hồi khách hàng chính xác và nhanh chóng.

## Chức năng chính

*   **🧠 Dạy Bot tự động (Learning Mode):** Admin có thể chat trực tiếp với Bot để bổ sung kiến thức. Bot sẽ âm thầm ghi nhớ và sử dụng kiến thức này để trả lời mọi khách hàng khác mà không cần sửa code.
*   **🖱️ Menu tương tác (Inline Menu):** Giao diện chuyên nghiệp với các nút bấm nhanh: Bảng giá, Hướng dẫn, Check IP, Liên hệ Support.
*   **🔍 Check IP/Host:** Tích hợp kiểm tra nhanh tình trạng IP/Domain qua API check-host.net, giúp khách hàng tự kiểm tra lỗi kết nối.
*   **🤖 AI Chat (Groq):** Sử dụng mô hình Llama 3.3 70B để trò chuyện tự nhiên, hiểu ngữ cảnh và văn phong hỗ trợ khách hàng.
*   **🆘 Thông báo khẩn cấp:** Tự động nhận diện từ khóa lỗi (sập, down, lỗi...) để báo ngay cho Admin và Group hỗ trợ.
*   **🛠️ Quản lý dễ dàng:** Toàn bộ bảng giá, dịch vụ và thông tin liên hệ được quản lý qua file `data.json` cực kỳ thuận tiện.
*   **📢 Broadcast:** Admin có thể gửi thông báo hàng loạt đến toàn bộ khách hàng đã từng tương tác với Bot.

## Cài đặt và Chạy Bot

### Yêu cầu
*   Node.js (v18 trở lên khuyến nghị)
*   Docker (tùy chọn nhưng khuyến nghị để chạy ổn định)
*   Tài khoản Telegram Bot (lấy Token từ @BotFather)
*   Tài khoản Groq Cloud (lấy API Key)

### Các bước cài đặt

1.  **Clone repository về máy:**
    ```bash
    git clone https://github.com/DauDau432/bot-chat-support.git
    cd bot-chat-support
    ```

2.  **Cấu hình biến môi trường:**
    *   Tạo file `.env` từ mẫu:
        ```bash
        cp .env.example .env
        ```
    *   Điền các thông tin: `BOT_TOKEN`, `GROQ_API_KEY`, `ADMIN_ID`, `GROUP_ID`.

3.  **Chạy với Docker (Khuyến nghị):**
    ```bash
    docker-compose up -d
    ```
    *Hoặc chạy trực tiếp với Node:*
    ```bash
    npm install
    node index.js
    ```

## Dành cho Admin

*   **Dạy Bot:** Chỉ cần chat riêng với Bot bất kỳ thông tin nào (VD: "Quy định bảo hành là 24h"), Bot sẽ ghi nhớ và dùng thông tin đó trả lời khách.
*   **Thống kê:** Dùng lệnh `/thongke` để xem số khách và lượt chat.
*   **Gửi tin hàng loạt:** Dùng `/thongbao <nội dung>` để nhắn tin cho tất cả khách.

## Cấu trúc thư mục

*   `index.js`: Mã nguồn xử lý chính của Bot.
*   `data.json`: Chứa bảng giá, cấu hình dịch vụ và prompt.
*   `memory.db`: Database SQLite lưu lịch sử chat và kiến thức đã học.
*   `.env`: Chứa các khóa bảo mật (Token, API Key).

## Tác giả
Phát triển bởi **@daukute (Đậu Đậu)**.
Dành riêng cho hệ thống **H2Cloud.vn**.
