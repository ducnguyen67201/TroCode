import type { AppLanguage } from '../shared/contracts';

export const APP_LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'vi', label: 'Tiếng Việt' },
] as const satisfies ReadonlyArray<{
  code: AppLanguage;
  label: string;
}>;

const VIETNAMESE_TRANSLATIONS: Readonly<Record<string, string>> = {
  "Looks ready for review": "Có vẻ sẵn sàng để giáo viên xem xét",
  "Could not verify everything": "Chưa thể xác minh toàn bộ",
  "Stop check": "Dừng kiểm tra",
  "Keep working": "Tiếp tục làm bài",
  "Close check panel": "Đóng bảng kiểm tra",
  "Files to submit": "Các tệp sẽ nộp",
  "Visible content only. Hidden code, other sprites and unseen pages were not checked.": "Chỉ kiểm tra nội dung đang hiển thị. Mã ẩn, nhân vật khác và các trang chưa hiển thị chưa được kiểm tra.",
  "Saved files only. Unsaved editor changes and program execution were not checked.": "Chỉ kiểm tra các tệp đã lưu. Chưa kiểm tra thay đổi chưa lưu và chưa chạy chương trình.",
  "No checklist was provided. Ask your teacher what to check.": "Chưa có tiêu chí kiểm tra. Hãy hỏi giáo viên về yêu cầu bài tập.",
  "Press ⌘⌥K / Ctrl+Alt+K to check your assignment.": "Nhấn ⌘⌥K / Ctrl+Alt+K để kiểm tra bài tập.",
  "Checking your assignment…": "Đang kiểm tra bài tập…",
  "Check shortcut unavailable. Use Check my work here.": "Không dùng được phím tắt. Chọn Kiểm tra bài làm tại đây.",

  "Could not confirm progress sync. Refresh your classroom session to see its saved state.": "Chưa xác nhận được việc đồng bộ tiến độ. Làm mới phiên lớp học để xem trạng thái đã lưu.",
  "This is feedback on an earlier snapshot, not a grade. Check again after making changes.": "Đây là góp ý cho bài làm tại thời điểm kiểm tra, không phải điểm số. Hãy kiểm tra lại sau khi chỉnh sửa.",
  "Send for teacher review": "Gửi giáo viên xem xét",
  "What Tro checked": "Nội dung Tro đã kiểm tra",
  "No work context": "Chưa có nội dung bài làm",
  "Saved files only": "Chỉ các tệp đã lưu",
  "Visible content only": "Chỉ nội dung đang hiển thị",
  "Could not verify": "Chưa thể xác minh",
  "Needs work": "Cần chỉnh sửa",
  "Looks met": "Có vẻ đạt yêu cầu",
  "Check finished": "Đã kiểm tra xong",
  "Checking your work…": "Đang kiểm tra bài làm…",
  "Assignment check": "Kiểm tra bài tập",
  '{count} active': '{count} đang hoạt động',
  '{count} day active': 'Hoạt động {count} ngày',
  '{count} days active': 'Hoạt động {count} ngày',
  '{count} finished task': '{count} tác vụ đã hoàn tất',
  '{count} finished tasks': '{count} tác vụ đã hoàn tất',
  '{count} tool call': '{count} lần gọi công cụ',
  '{count} tool calls': '{count} lần gọi công cụ',
  '{current} of {maximum} steps': '{current} trên {maximum} bước',
  '{rate}% of finished tasks completed':
    '{rate}% tác vụ đã kết thúc được hoàn thành',
  'A decision is waiting.': 'Một quyết định đang chờ bạn.',
  'A durable record of finished work, restored when you reopen Tro.':
    'Bản ghi bền vững về công việc đã hoàn tất, được khôi phục khi bạn mở lại Tro.',
  'A private, session-only view of how Tro is working across your tasks.':
    'Góc nhìn riêng tư chỉ trong phiên về cách Tro hoạt động trên các tác vụ của bạn.',
  'A useful assistant answer or an evidence-backed tool result.':
    'Câu trả lời hữu ích từ trợ lý hoặc kết quả công cụ có bằng chứng.',
  Act: 'Thực hiện',
  'A view of how Tro is working across your saved tasks and lifecycle activity.':
    'Góc nhìn về cách Tro hoạt động trên các tác vụ đã lưu và vòng đời của chúng.',
  About: 'Giới thiệu',
  'About Tro': 'Về Tro',
  'Access code': 'Mã truy cập',
  'Access required': 'Yêu cầu quyền truy cập',
  Accessibility: 'Trợ năng',
  act: 'thực hiện',
  'Activate membership': 'Kích hoạt tư cách thành viên',
  'Adds your words without sending.': 'Thêm lời nói của bạn mà không gửi đi.',
  'Activate your Tro membership': 'Kích hoạt tư cách thành viên Tro',
  Activating: 'Đang kích hoạt',
  'Activating…': 'Đang kích hoạt…',
  'Activation code': 'Mã kích hoạt',
  acting: 'đang thực hiện',
  Action: 'Hành động',
  Activity: 'Hoạt động',
  Agent: 'Trợ lý',
  'App interface': 'Giao diện ứng dụng',
  'App language': 'Ngôn ngữ ứng dụng',
  'Application update': 'Cập nhật ứng dụng',
  'Across sessions': 'Qua nhiều phiên',
  'Answer below by voice or text. Your response will continue this task.':
    'Trả lời bên dưới bằng giọng nói hoặc văn bản. Phản hồi của bạn sẽ tiếp tục tác vụ này.',
  Answer: 'Trả lời',
  answer: 'trả lời',
  'Answer Tro to continue this task': 'Trả lời Tro để tiếp tục tác vụ',
  'Ask Tro': 'Hỏi Tro',
  'Ask Tro selected': 'Đã chọn Hỏi Tro',
  'App controls will use {appLanguage}; new voice turns will use {spokenLanguage}.':
    'Giao diện ứng dụng sẽ dùng {appLanguage}; lượt nói mới sẽ dùng {spokenLanguage}.',
  'Assistant only': 'Chỉ dùng trợ lý',
  'Assistant-only tasks need no tools. Tool activity will appear here when used.':
    'Tác vụ chỉ dùng trợ lý không cần công cụ. Hoạt động công cụ sẽ xuất hiện ở đây khi được sử dụng.',
  'Best {count}d': 'Tốt nhất {count} ngày',
  blocked: 'bị chặn',
  call: 'lần gọi',
  calls: 'lần gọi',
  cancelled: 'đã hủy',
  'Check for updates': 'Kiểm tra bản cập nhật',
  'Check again': 'Kiểm tra lại',
  'Checking…': 'Đang kiểm tra…',
  'Checking your membership…': 'Đang kiểm tra tư cách thành viên…',
  'Choose the language used for navigation, settings, and other Tro controls.':
    'Chọn ngôn ngữ dùng cho điều hướng, cài đặt và các thành phần điều khiển khác của Tro.',
  'Close settings': 'Đóng cài đặt',
  Companion: 'Bạn đồng hành',
  Connections: 'Kết nối',
  'Connect tools Tro can use on your behalf.':
    'Kết nối các công cụ Tro có thể dùng thay bạn.',
  'Desktop pet': 'Thú cưng trên màn hình',
  'Show desktop pet': 'Hiển thị thú cưng trên màn hình',
  'Show a stateful animated companion on your desktop. Drag it anywhere you like; it reacts to task progress, pointer hover, and occasional local task or classroom messages. Hover checks only whether the pointer is over the pet on this device; coordinates are never recorded, stored, or sent. It does not inspect apps, websites, or typing.':
    'Hiển thị một bạn đồng hành có trạng thái và chuyển động trên màn hình. Bạn có thể kéo thú cưng đến bất cứ đâu; thú cưng phản ứng với tiến độ tác vụ, thao tác rê chuột và đôi khi hiển thị thông báo tác vụ hoặc lớp học ngay trên thiết bị. Phản ứng rê chuột chỉ kiểm tra con trỏ có ở trên thú cưng hay không; tọa độ không bao giờ được ghi lại, lưu trữ hay gửi đi. Thú cưng không đọc ứng dụng, trang web hay thao tác gõ phím.',
  'Keep going': 'Tiếp tục nhé',
  'While you wait': 'Trong lúc chờ',
  'Nice work': 'Làm tốt lắm',
  Thinking: 'Đang suy nghĩ',
  'On it': 'Đang làm',
  'Choose how you talk with Tro': 'Chọn cách bạn trò chuyện với Tro',
  'Choose your spoken language, then give Tro the macOS permissions it needs to hear your request, use the computer, and confirm the result. You stay in control and can revoke permissions in System Settings at any time.':
    'Chọn ngôn ngữ nói, sau đó cấp cho Tro các quyền macOS cần thiết để nghe yêu cầu, sử dụng máy tính và xác nhận kết quả. Bạn luôn nắm quyền kiểm soát và có thể thu hồi quyền trong Cài đặt hệ thống bất cứ lúc nào.',
  'Collapse sidebar': 'Thu gọn thanh bên',
  'Compile or run a task and its behavior will appear here.':
    'Biên dịch hoặc chạy một tác vụ và cách hoạt động của tác vụ sẽ xuất hiện tại đây.',
  Connected: 'Đã kết nối',
  'Connect computer': 'Kết nối máy tính',
  Connecting: 'Đang kết nối',
  'Connecting…': 'Đang kết nối…',
  'Finishing your request…': 'Đang hoàn tất yêu cầu của bạn…',
  'Getting voice ready…': 'Đang chuẩn bị giọng nói…',
  Hold: 'Giữ',
  'Connecting to OpenAI voice…': 'Đang kết nối với giọng nói OpenAI…',
  Conversation: 'Cuộc trò chuyện',
  completed: 'đã hoàn tất',
  'Completed, stopped, and unsuccessful tasks appear with their scope, conversation, and outcome.':
    'Các tác vụ đã hoàn thành, đã dừng hoặc chưa thành công sẽ xuất hiện cùng phạm vi, cuộc trò chuyện và kết quả.',
  'Complete an assignment with Tro to see learning guidance here.':
    'Hoàn thành một bài tập với Tro để xem hướng dẫn học tập tại đây.',
  'Computer use': 'Điều khiển máy tính',
  'Continue to Tro': 'Tiếp tục vào Tro',
  'Continue with access code': 'Tiếp tục bằng mã truy cập',
  'Continue with Free': 'Tiếp tục với gói Miễn phí',
  Copy: 'Sao chép',
  Copied: 'Đã sao chép',
  'Current app session': 'Phiên ứng dụng hiện tại',
  Deny: 'Từ chối',
  Description: 'Mô tả',
  'Describe the outcome': 'Mô tả kết quả mong muốn',
  Dictating: 'Đang đọc chính tả',
  'Dictating… Release to insert text without sending.':
    'Đang đọc chính tả… Thả phím để chèn văn bản mà không gửi.',
  Dictation: 'Chính tả',
  'Dictation added to your Tro draft.':
    'Đã thêm nội dung chính tả vào bản nháp Tro.',
  'Dictation complete': 'Chính tả hoàn tất',
  'Dictation inserted.': 'Đã chèn nội dung chính tả.',
  'Dictation needs attention': 'Chính tả cần chú ý',
  'Dictation adds text without sending. Task gives the spoken request to Tro after a one-second Escape window.':
    'Chính tả thêm văn bản mà không gửi. Tác vụ chuyển yêu cầu bằng giọng nói cho Tro sau khoảng một giây để nhấn Escape hủy.',
  'Describe the finish line. Tro will choose the appropriate tools and verify the result.':
    'Mô tả đích đến. Tro sẽ chọn công cụ phù hợp và xác minh kết quả.',
  'Desktop agent': 'Trợ lý máy tính',
  'Weekly usage · {percent}% left': 'Mức dùng tuần · còn {percent}%',
  'Plan & weekly usage': 'Gói và mức dùng tuần',
  'Weekly usage': 'Mức dùng tuần',
  '{percent}% left': 'Còn {percent}%',
  '{remaining} of {limit} messages left':
    'Còn {remaining} trong tổng số {limit} tin nhắn',
  'Usage details unavailable': 'Chưa có thông tin mức dùng',
  'Downloading update…': 'Đang tải bản cập nhật…',
  Enabled: 'Đã bật',
  'Enable all permissions': 'Bật tất cả quyền',
  'Enable Tro to work for you': 'Cho phép Tro làm việc cho bạn',
  'Enter the access code provided by the Tro team. Each account can use one code, and each code has a limited number of users.':
    'Nhập mã truy cập do đội ngũ Tro cung cấp. Mỗi tài khoản chỉ có thể dùng một mã và mỗi mã có số lượng người dùng giới hạn.',
  'Enter a Tro access code, or continue with the Free plan. You can add a promo code later in Settings when you are ready to upgrade.':
    'Nhập mã truy cập Tro hoặc tiếp tục với gói Miễn phí. Bạn có thể thêm mã khuyến mãi sau trong phần Cài đặt khi sẵn sàng nâng cấp.',
  'Enter your access code': 'Nhập mã truy cập của bạn',
  'Enter your promo code': 'Nhập mã khuyến mãi của bạn',
  'Enter your Tro access code': 'Nhập mã truy cập Tro của bạn',
  'Expand sidebar': 'Mở rộng thanh bên',
  event: 'sự kiện',
  events: 'sự kiện',
  'EVENTS OBSERVED': 'SỰ KIỆN ĐÃ GHI NHẬN',
  'Example tasks': 'Tác vụ ví dụ',
  Execution: 'Thực thi',
  failed: 'thất bại',
  'Final setup step': 'Bước thiết lập cuối cùng',
  Finished: 'Đã kết thúc',
  'Finished task history': 'Lịch sử tác vụ đã kết thúc',
  'Finished tasks will settle here.': 'Tác vụ đã kết thúc sẽ xuất hiện ở đây.',
  'Finish setup': 'Hoàn tất thiết lập',
  'Finishing transcript…': 'Đang hoàn tất bản ghi âm…',
  'Finishing safely…': 'Đang hoàn tất an toàn…',
  'Finishing setup…': 'Đang hoàn tất thiết lập…',
  General: 'Chung',
  'General-purpose agent': 'Trợ lý đa năng',
  'Language, behavior, and task safety.':
    'Ngôn ngữ, hành vi và an toàn tác vụ.',
  Guide: 'Hướng dẫn',
  guide: 'hướng dẫn',
  History: 'Lịch sử',
  'How Tro helped': 'Tro đã hỗ trợ như thế nào',
  'How to improve': 'Cách cải thiện',
  'In motion': 'Đang thực hiện',
  Insights: 'Phân tích',
  'Insights overview': 'Tổng quan phân tích',
  'Interface language': 'Ngôn ngữ giao diện',
  interpreting: 'đang phân tích',
  Latest: 'Mới nhất',
  'Language & permissions': 'Ngôn ngữ và quyền truy cập',
  'Language first': 'Chọn ngôn ngữ trước',
  'Keep voice input separate': 'Tách riêng ngôn ngữ giọng nói',
  'Keep the outcome in view.': 'Luôn theo sát kết quả.',
  'Language & settings': 'Ngôn ngữ và cài đặt',
  Listening: 'Đang nghe',
  'Listening… Release the voice shortcut to send.':
    'Đang nghe… Thả phím tắt giọng nói để gửi.',
  'Giving Tro a task': 'Đang giao việc cho Tro',
  'Giving Tro a task… Release to transcribe, then press Escape to cancel.':
    'Đang giao việc cho Tro… Thả phím để phiên âm, sau đó nhấn Escape để hủy.',
  'Inserting Dictation': 'Đang chèn nội dung chính tả',
  'Inserting dictated text…': 'Đang chèn văn bản đã đọc…',
  'Insertion could not be verified. Text kept in your Tro draft.':
    'Không thể xác minh việc chèn. Văn bản đã được giữ trong bản nháp Tro.',
  'Live activity': 'Hoạt động trực tiếp',
  'Live lifecycle': 'Vòng đời trực tiếp',
  'Live session': 'Phiên trực tiếp',
  'Live task': 'Tác vụ đang chạy',
  'Lifecycle activity': 'Hoạt động vòng đời',
  'Lifecycle events per day for the last six weeks':
    'Sự kiện vòng đời mỗi ngày trong sáu tuần qua',
  'Learning focus': 'Trọng tâm học tập',
  'Loading application update status…':
    'Đang tải trạng thái cập nhật ứng dụng…',
  'Loading saved task history…': 'Đang tải lịch sử tác vụ đã lưu…',
  'Loading version…': 'Đang tải phiên bản…',
  'Loading…': 'Đang tải…',
  'Lets Tro click, type, and control apps for you.':
    'Cho phép Tro nhấp, nhập và điều khiển ứng dụng giúp bạn.',
  'Lets Tro see the screen and verify its work.':
    'Cho phép Tro xem màn hình và xác minh công việc.',
  'Lets you use push-to-talk voice commands.':
    'Cho phép bạn dùng lệnh giọng nói nhấn-để-nói.',
  'Manage Tro’s interface language, voice input, and installed application.':
    'Quản lý ngôn ngữ giao diện, đầu vào giọng nói và ứng dụng Tro đã cài đặt.',
  'Mute other audio while speaking': 'Tắt âm thanh khác khi đang nói',
  'Mute system output while you hold the voice shortcut, then restore its previous mute state when you release.':
    'Tắt âm thanh hệ thống khi bạn giữ phím tắt giọng nói, sau đó khôi phục trạng thái tắt tiếng trước đó khi bạn thả phím.',
  'New task': 'Tác vụ mới',
  'Needs attention': 'Cần chú ý',
  'May need more support': 'Có thể cần hỗ trợ thêm',
  'No learning challenge identified yet':
    'Chưa xác định được nội dung học tập nào đang gây khó khăn',
  'No conversation was recorded.': 'Không có cuộc trò chuyện nào được ghi lại.',
  'No lifecycle activity was captured for this task.':
    'Không ghi nhận hoạt động vòng đời nào cho tác vụ này.',
  'No tool calls': 'Không có lần gọi công cụ',
  'No tool calls yet': 'Chưa có lần gọi công cụ',
  'No active task': 'Không có tác vụ đang chạy',
  'No task behavior yet': 'Chưa có hoạt động tác vụ',
  'Not compiled': 'Chưa biên dịch',
  'Not started': 'Chưa bắt đầu',
  'Not connected': 'Chưa kết nối',
  'Not configured': 'Chưa cấu hình',
  'Not required': 'Không bắt buộc',
  Observe: 'Theo dõi',
  observing: 'đang quan sát',
  'Open task record': 'Mở bản ghi tác vụ',
  'Open permission settings': 'Mở cài đặt quyền',
  'Opening Free…': 'Đang mở gói Miễn phí…',
  'Plan access': 'Quyền truy cập gói',
  'Plan, access, and organization details.':
    'Thông tin về gói, quyền truy cập và tổ chức.',
  Product: 'Sản phẩm',
  'Promo code': 'Mã khuyến mãi',
  'Promo or access code': 'Mã khuyến mãi hoặc mã truy cập',
  'Apply promo code': 'Áp dụng mã khuyến mãi',
  'Your promo code is active on this account.':
    'Mã khuyến mãi đang hoạt động trên tài khoản này.',
  'You can keep using Tro Free. Enter a promo code here whenever you are ready to upgrade.':
    'Bạn có thể tiếp tục dùng Tro Miễn phí. Hãy nhập mã khuyến mãi tại đây khi bạn sẵn sàng nâng cấp.',
  'OpenAI GPT Transcribe': 'OpenAI GPT Transcribe',
  'One-time setup': 'Thiết lập một lần',
  'Personal preferences': 'Tùy chọn cá nhân',
  Preferences: 'Tùy chọn',
  'Primary language': 'Ngôn ngữ chính',
  'Private on-device summary': 'Tóm tắt riêng tư trên thiết bị',
  'GPT Transcribe voice input is ready. The microphone stays off until you hold the shortcut.':
    'Nhập liệu giọng nói GPT Transcribe đã sẵn sàng. Micrô sẽ tắt cho đến khi bạn giữ phím tắt.',
  'Restart to update': 'Khởi động lại để cập nhật',
  'Restart to install Tro {version}': 'Khởi động lại để cài đặt Tro {version}',
  'Restarting…': 'Đang khởi động lại…',
  Saved: 'Đã lưu',
  'Saved task history': 'Lịch sử tác vụ đã lưu',
  'Save preferences': 'Lưu tùy chọn',
  'Saving…': 'Đang lưu…',
  'Screen Recording': 'Ghi màn hình',
  Scoping: 'Đang xác định phạm vi',
  'Select and copy the code': 'Chọn và sao chép mã',
  'Send your reference code to the Tro team. When your access is approved, paste the activation code you receive below.':
    'Gửi mã tham chiếu cho đội ngũ Tro. Khi quyền truy cập được phê duyệt, hãy dán mã kích hoạt bạn nhận được vào bên dưới.',
  'Send answer': 'Gửi câu trả lời',
  'Send steering': 'Gửi chỉ dẫn',
  'Sending…': 'Đang gửi…',
  'Session task record': 'Bản ghi tác vụ phiên này',
  'Session only': 'Chỉ phiên này',
  'Session summary': 'Tóm tắt phiên',
  'RECENT LEARNING SIGNAL': 'TÍN HIỆU HỌC TẬP GẦN ĐÂY',
  Settings: 'Cài đặt',
  'Settings sections': 'Các mục cài đặt',
  'Shape how Tro appears beside your work.':
    'Điều chỉnh cách Tro xuất hiện bên cạnh công việc của bạn.',
  'Speech, shortcuts, and audio behavior.':
    'Giọng nói, phím tắt và cách xử lý âm thanh.',
  latest: 'mới nhất',
  'Show me how to organize my Downloads folder':
    'Chỉ tôi cách sắp xếp thư mục Tải về',
  'Sign out': 'Đăng xuất',
  'Signing out…': 'Đang đăng xuất…',
  'Something needs attention': 'Có nội dung cần chú ý',
  'Speak now…': 'Hãy nói ngay…',
  'Sending voice Task': 'Đang gửi tác vụ giọng nói',
  'Sending voice task…': 'Đang gửi tác vụ giọng nói…',
  'Spoken language': 'Ngôn ngữ nói',
  'Starting microphone': 'Đang khởi động micrô',
  'Start task': 'Bắt đầu tác vụ',
  'Start a task': 'Bắt đầu một tác vụ',
  'Starting automatically… Press Escape at any time to stop.':
    'Đang tự động bắt đầu… Nhấn Escape bất cứ lúc nào để dừng.',
  'Starting…': 'Đang bắt đầu…',
  'Steps observed': 'Số bước đã ghi nhận',
  'Steer the active task': 'Điều hướng tác vụ đang chạy',
  'Steering is reviewed at the next safe boundary.':
    'Chỉ dẫn sẽ được xem xét tại ranh giới an toàn tiếp theo.',
  'Stop task': 'Dừng tác vụ',
  'Stopping…': 'Đang dừng…',
  'Success looks like': 'Kết quả thành công',
  Success: 'Thành công',
  System: 'Hệ thống',
  'System audio muting is currently available on macOS.':
    'Tính năng tắt âm thanh hệ thống hiện có trên macOS.',
  task: 'tác vụ',
  Task: 'Tác vụ',
  tasks: 'tác vụ',
  Tasks: 'Tác vụ',
  'TASK COMPLETION RATE': 'TỶ LỆ HOÀN THÀNH TÁC VỤ',
  'TASKS OBSERVED': 'TÁC VỤ ĐÃ GHI NHẬN',
  'Task details': 'Chi tiết tác vụ',
  'Task behavior': 'Hoạt động tác vụ',
  'Task events will appear here.': 'Sự kiện tác vụ sẽ xuất hiện ở đây.',
  'Task in motion': 'Tác vụ đang thực hiện',
  'Task needs attention': 'Tác vụ cần chú ý',
  'Text kept in your Tro draft.': 'Văn bản đã được giữ trong bản nháp Tro.',
  'Text kept in your Tro draft. {summary}':
    'Văn bản đã được giữ trong bản nháp Tro. {summary}',
  'To {destination}': 'Tới {destination}',
  'Transcribing Dictation': 'Đang phiên âm chính tả',
  'Transcribing Task': 'Đang phiên âm tác vụ',
  'Preparing Dictation': 'Đang chuẩn bị chính tả',
  'Preparing voice Task': 'Đang chuẩn bị tác vụ giọng nói',
  'Voice Task needs attention': 'Tác vụ giọng nói cần chú ý',
  'Voice Task sent': 'Đã gửi tác vụ giọng nói',
  'Voice task sent.': 'Đã gửi tác vụ giọng nói.',
  'Voice input could not be completed.':
    'Không thể hoàn tất đầu vào giọng nói.',
  'Voice shortcuts': 'Phím tắt giọng nói',
  'macOS: Command + Control · Windows: left Control + left Alt':
    'macOS: Command + Control · Windows: Control trái + Alt trái',
  'No speech was detected. The draft was left unchanged.':
    'Không phát hiện giọng nói. Bản nháp không thay đổi.',
  'The draft was restored because part of the recording failed.':
    'Bản nháp đã được khôi phục vì một phần bản ghi bị lỗi.',
  'Task stopped safely': 'Tác vụ đã dừng an toàn',
  'Task trail': 'Dấu vết tác vụ',
  Target: 'Đích',
  'Text tasks work now. Connect only when you want the agent to use visible applications.':
    'Tác vụ văn bản đã sẵn sàng. Chỉ kết nối khi bạn muốn trợ lý sử dụng các ứng dụng hiển thị trên màn hình.',
  'Text tasks work without microphone or computer permissions. Choose your spoken language now; voice and computer use remain optional and can be connected only when you need them.':
    'Tác vụ văn bản hoạt động mà không cần quyền micrô hoặc máy tính. Hãy chọn ngôn ngữ nói; giọng nói và điều khiển máy tính vẫn là tùy chọn và chỉ cần kết nối khi bạn sử dụng.',
  Talk: 'Nói',
  'The task finished. Its conversation and activity are available in History.':
    'Tác vụ đã kết thúc. Cuộc trò chuyện và hoạt động có trong Lịch sử.',
  'The trail is clear': 'Chưa có dấu vết',
  'The finished task is now in your session trail. Start another outcome whenever you are ready.':
    'Tác vụ đã kết thúc hiện có trong dấu vết phiên này. Hãy bắt đầu một kết quả mới khi bạn sẵn sàng.',
  'This answer stays attached to the current task.':
    'Câu trả lời này sẽ được gắn với tác vụ hiện tại.',
  'Tool calls': 'Lần gọi công cụ',
  'Tool usage': 'Mức sử dụng công cụ',
  'Tools selected at runtime': 'Công cụ được chọn khi chạy',
  'Tools used': 'Công cụ đã dùng',
  'Tro could not start automatically. You can try again.':
    'Tro không thể tự động bắt đầu. Bạn có thể thử lại.',
  'Tro uses this to keep voice transcription in the language you expect. You can change it later in Settings.':
    'Tro dùng lựa chọn này để phiên âm giọng nói đúng ngôn ngữ bạn mong đợi. Bạn có thể đổi lại trong Cài đặt.',
  'Task activity': 'Hoạt động tác vụ',
  'Tro needs your input': 'Tro cần phản hồi của bạn',
  'Tro sends this as a transcription hint so short or noisy speech is less likely to be interpreted as an unexpected language or script.':
    'Tro gửi lựa chọn này làm gợi ý phiên âm để lời nói ngắn hoặc có tạp âm ít bị nhận diện nhầm thành ngôn ngữ hay hệ chữ khác.',
  'Sends your request to Tro.': 'Gửi yêu cầu của bạn cho Tro.',
  Switch: 'Chuyển',
  'Switch mode': 'Chuyển chế độ',
  'Tro registers itself with macOS for Screen Recording. If System Settings opens, switch on the Tro row—you should not need the + button. Then return here and we’ll connect automatically. Screen Recording may require restarting Tro once.':
    'Tro tự đăng ký với macOS để ghi màn hình. Nếu Cài đặt hệ thống mở ra, hãy bật Tro trong danh sách—bạn không cần dùng nút +. Sau đó quay lại đây và chúng tôi sẽ tự động kết nối. Quyền ghi màn hình có thể yêu cầu khởi động lại Tro một lần.',
  'Updates unavailable': 'Không thể cập nhật',
  'Updates as your agent works': 'Cập nhật khi trợ lý làm việc',
  Unavailable: 'Không khả dụng',
  'Understanding request': 'Đang hiểu yêu cầu',
  'Use another Google account': 'Dùng tài khoản Google khác',
  'Use the app in': 'Sử dụng ứng dụng bằng',
  'Version {version}': 'Phiên bản {version}',
  'Voice and language': 'Giọng nói và ngôn ngữ',
  Voice: 'Giọng nói',
  'Voice input': 'Đầu vào giọng nói',
  'Voice mode': 'Chế độ giọng nói',
  'Voice ready.': 'Giọng nói đã sẵn sàng.',
  'Voice recognition is unavailable. Type your request instead.':
    'Nhận dạng giọng nói không khả dụng. Hãy nhập yêu cầu bằng bàn phím.',
  'Waiting for microphone access…': 'Đang chờ quyền truy cập micrô…',
  'Write my words': 'Viết lời của tôi',
  'Write my words selected': 'Đã chọn Viết lời của tôi',
  'Ready for your next voice shortcut.':
    'Sẵn sàng cho phím tắt giọng nói tiếp theo.',
  'Write my words adds text without sending. Ask Tro sends the spoken request after a one-second Escape window.':
    'Viết lời của tôi sẽ thêm văn bản mà không gửi. Hỏi Tro sẽ gửi yêu cầu bằng giọng nói sau khoảng một giây để nhấn Escape hủy.',
  'macOS: Command + Backslash · Windows: Control + Backslash':
    'macOS: Command + dấu gạch chéo ngược · Windows: Control + dấu gạch chéo ngược',
  'to talk': 'để nói',
  'Type, dictate, or use Ask Tro to answer…':
    'Nhập, đọc chính tả hoặc dùng Hỏi Tro để trả lời…',
  'Type a task, or use Write my words to add text without sending…':
    'Nhập một tác vụ hoặc dùng Viết lời của tôi để thêm văn bản mà không gửi…',
  Transcribing: 'Đang phiên âm',
  Workspace: 'Không gian làm việc',
  'Version, updates, and product details.':
    'Phiên bản, bản cập nhật và thông tin sản phẩm.',
  'What language will you usually speak?': 'Bạn thường sẽ nói ngôn ngữ nào?',
  'What felt difficult': 'Nội dung bạn có thể đang gặp khó khăn',
  'What should we accomplish?': 'Chúng ta cần hoàn thành điều gì?',
  'What should we do next?': 'Tiếp theo chúng ta nên làm gì?',
  'Why Tro stopped': 'Lý do Tro dừng lại',
  You: 'Bạn',
  'Your active task has not settled yet.': 'Tác vụ đang chạy chưa kết thúc.',
  'Your move': 'Đến lượt bạn',
  'Your reference code': 'Mã tham chiếu của bạn',
  'Fix the failing tests in my project':
    'Sửa các bài kiểm thử đang lỗi trong dự án của tôi',
  'Follow the live signal, steer the next safe step, or stop the task at any time.':
    'Theo dõi tín hiệu trực tiếp, điều hướng bước an toàn tiếp theo hoặc dừng tác vụ bất cứ lúc nào.',
  Less: 'Ít hơn',
  More: 'Nhiều hơn',
  'Last six weeks': 'Sáu tuần qua',
  'Membership access': 'Quyền thành viên',
  'Membership needs attention': 'Tư cách thành viên cần được chú ý',
  Microphone: 'Micrô',
  Mode: 'Chế độ',
  'No execution steps': 'Không có bước thực thi',
  'Verified completions': 'Lần hoàn tất đã xác minh',
  'Registered tools run automatically; OS permissions and Workspace bounds still apply':
    'Công cụ đã đăng ký tự động chạy; quyền hệ điều hành và giới hạn Không gian làm việc vẫn áp dụng',
  Required: 'Bắt buộc',
  Blocked: 'Bị chặn',
  Checking: 'Đang kiểm tra',
  'Try again': 'Thử lại',
  'Type or hold the voice shortcut to answer…':
    'Nhập hoặc giữ phím tắt giọng nói để trả lời…',
  'Waiting for the OpenAI agent provider before starting.':
    'Đang chờ nhà cung cấp trợ lý OpenAI trước khi bắt đầu.',
  'Waiting for OpenAI and the CUA Driver before starting.':
    'Đang chờ OpenAI và trình điều khiển CUA trước khi bắt đầu.',
  'Open YouTube for me': 'Mở YouTube giúp tôi',
  'Open YouTube for me, research a topic, fix code, or guide me through an app…':
    'Mở YouTube giúp tôi, nghiên cứu một chủ đề, sửa mã hoặc hướng dẫn tôi dùng một ứng dụng…',
  'Optional permissions are shown here for visibility, but they do not block the workspace. Tro asks for them only when you choose voice or computer use.':
    'Các quyền tùy chọn được hiển thị để bạn dễ theo dõi nhưng không chặn không gian làm việc. Tro chỉ yêu cầu khi bạn chọn dùng giọng nói hoặc điều khiển máy tính.',
  'Optional tool': 'Công cụ tùy chọn',
  'Outcome & activity': 'Kết quả và hoạt động',
  'Outcome first': 'Kết quả là ưu tiên',
  'Outcome reached': 'Đã đạt kết quả',
  'Outcome recorded': 'Đã ghi nhận kết quả',
  Overview: 'Tổng quan',
  paused: 'đã tạm dừng',
  'Paste your activation code': 'Dán mã kích hoạt của bạn',
  'Pause, stop, or change the next step…':
    'Tạm dừng, dừng hoặc thay đổi bước tiếp theo…',
  planning: 'đang lập kế hoạch',
  'Permission setup needs attention': 'Thiết lập quyền cần được chú ý',
  'Preparing task': 'Đang chuẩn bị tác vụ',
  'Previous access ended on': 'Quyền truy cập trước đã kết thúc vào',
  Progress: 'Tiến độ',
  'Quick setup': 'Thiết lập nhanh',
  'Ready when the agent needs to inspect or operate an application.':
    'Sẵn sàng khi trợ lý cần xem hoặc điều khiển một ứng dụng.',
  ready: 'sẵn sàng',
  'Ready. Starting automatically… Press Escape at any time to stop.':
    'Sẵn sàng. Đang tự động bắt đầu… Nhấn Escape bất cứ lúc nào để dừng.',
  'Renew your Tro membership': 'Gia hạn tư cách thành viên Tro',
  'Request access': 'Yêu cầu quyền truy cập',
  'Research three note-taking apps and compare them':
    'Nghiên cứu và so sánh ba ứng dụng ghi chú',
  'Return to Agent to watch, steer, or stop it. Its final record will appear here.':
    'Quay lại Trợ lý để theo dõi, điều hướng hoặc dừng tác vụ. Bản ghi cuối cùng sẽ xuất hiện ở đây.',
  'Return to live task': 'Quay lại tác vụ đang chạy',
  'Same task': 'Cùng tác vụ',
  'Knowledge Spaces': 'Không gian tri thức',
  'Assigned Activities': 'Hoạt động được giao',
  'Current task': 'Tác vụ hiện tại',
  'Reusable context': 'Ngữ cảnh tái sử dụng',
  'Your work': 'Công việc của bạn',
  'New Space': 'Không gian mới',
  'Create Space': 'Tạo không gian',
  'Join a Space': 'Tham gia không gian',
  'Join Space': 'Tham gia',
  Library: 'Thư viện',
  Activities: 'Hoạt động',
  People: 'Mọi người',
  'Upload files': 'Tải tệp lên',
  'Snapshot folder': 'Chụp nhanh thư mục',
  'Review upload': 'Xem lại nội dung tải lên',
  'Upload reviewed files': 'Tải các tệp đã xem lại',
  'Activity editor': 'Trình soạn Hoạt động',
  'Save draft': 'Lưu bản nháp',
  'Publish immutable version': 'Xuất bản phiên bản bất biến',
  'Work context': 'Ngữ cảnh làm việc',
  'Current screen': 'Màn hình hiện tại',
  'Workspace folder': 'Thư mục Workspace',
  'Guidance style': 'Kiểu hướng dẫn',
  'Guided debugging': 'Gỡ lỗi có hướng dẫn',
  'Socratic questions': 'Câu hỏi gợi mở',
  'Observable criteria': 'Tiêu chí có thể quan sát',
  'Create a Run': 'Tạo một đợt thực hiện',
  'Open Run': 'Mở đợt thực hiện',
  'People & groups': 'Mọi người và nhóm',
  'Create group': 'Tạo nhóm',
  'Create 7-day join code': 'Tạo mã tham gia 7 ngày',
  'Join code': 'Mã tham gia',
  'Start Activity': 'Bắt đầu Hoạt động',
  'I need help': 'Tôi cần trợ giúp',
  'Help request sent': 'Đã gửi yêu cầu trợ giúp',
  'Pinned sources': 'Nguồn đã ghim',
  'Choose an existing folder': 'Chọn thư mục hiện có',
  'Create from published starter': 'Tạo từ bộ khởi đầu đã xuất bản',
  'Explicit submission': 'Nộp bài rõ ràng',
  'Review files to submit': 'Xem lại tệp cần nộp',
  'Submit reviewed files': 'Nộp các tệp đã xem lại',
  'Submission received': 'Đã nhận nội dung nộp',
  'Facilitator dashboard': 'Bảng điều khiển người hướng dẫn',
  'Observable evidence': 'Bằng chứng có thể quan sát',
  'Help queue': 'Hàng đợi trợ giúp',
  'Evidence patterns': 'Mẫu bằng chứng',
  'Suggested support': 'Hỗ trợ đề xuất',
  participants: 'người tham gia',
  Classes: 'Lớp học',
  class: 'lớp',
  classes: 'lớp',
  'Class workspaces': 'Không gian lớp học',
  'Class workspace': 'Không gian lớp học',
  'Keep each class easy to find, switch between, and manage from one place.':
    'Dễ dàng tìm, chuyển đổi và quản lý từng lớp học tại một nơi.',
  Teacher: 'Giáo viên',
  Student: 'Học sinh',
  'Role pending': 'Đang chờ phân vai',
  'Account ready': 'Tài khoản đã sẵn sàng',
  Account: 'Tài khoản',
  Class: 'Lớp học',
  'Your classroom role has not been assigned yet.':
    'Vai trò lớp học của bạn chưa được chỉ định.',
  'An administrator assigns Teacher or Student after your account is created.':
    'Quản trị viên sẽ chỉ định Giáo viên hoặc Học sinh sau khi tài khoản được tạo.',
  'New class workspace': 'Không gian lớp học mới',
  'Create a class': 'Tạo lớp học',
  'Start a dedicated home for a new group.':
    'Tạo một không gian riêng cho nhóm mới.',
  'Create class': 'Tạo lớp học',
  'Creating…': 'Đang tạo…',
  'Join a class': 'Tham gia lớp học',
  'Use a code shared for your assigned role.':
    'Dùng mã được chia sẻ cho vai trò của bạn.',
  'Join class': 'Vào lớp học',
  'Joining…': 'Đang tham gia…',
  'No class workspaces yet': 'Chưa có không gian lớp học',
  'Create a class, then add registered Teachers and Students.':
    'Tạo lớp học rồi thêm Giáo viên và Học sinh đã đăng ký.',
  'A Teacher can add your registered account to a class.':
    'Giáo viên có thể thêm tài khoản đã đăng ký của bạn vào lớp.',
  'Teacher-managed workspace access':
    'Quyền truy cập không gian do Giáo viên quản lý',
  'Your class workspaces appear here only after a Teacher adds your registered account.':
    'Không gian lớp học chỉ xuất hiện tại đây sau khi Giáo viên thêm tài khoản đã đăng ký của bạn.',
  'After your Teacher adds you to the class, enter the room code. Tro will wait with you until class starts.':
    'Sau khi Giáo viên thêm bạn vào lớp, hãy nhập mã phòng. Tro sẽ chờ cùng bạn cho đến khi lớp bắt đầu.',
  'Class owner': 'Chủ lớp học',
  'Open class': 'Mở lớp học',
  'All class workspaces': 'Tất cả không gian lớp học',
  'Switch class': 'Chuyển lớp',
  'Switch class workspace': 'Chuyển không gian lớp học',
  'Choose a class': 'Chọn một lớp học',
  'Current class': 'Lớp hiện tại',
  'Your classroom role': 'Vai trò lớp học của bạn',
  'Class overview': 'Tổng quan lớp học',
  resources: 'tài nguyên',
  resource: 'tài nguyên',
  people: 'người',
  Teaching: 'Đang giảng dạy',
  Learning: 'Đang học',
  'Class community': 'Cộng đồng lớp học',
  'on the roster': 'trong danh sách lớp',
  'Roster composition': 'Thành phần lớp học',
  'At a glance': 'Tổng quan nhanh',
  Teachers: 'Giáo viên',
  Students: 'Học sinh',
  'Roles are verified before anyone is added.':
    'Vai trò được xác minh trước khi thêm bất kỳ ai.',
  'Add registered accounts': 'Thêm tài khoản đã đăng ký',
  'Add members': 'Thêm thành viên',
  'Build the roster': 'Xây dựng danh sách lớp',
  'Add people after their account exists and an administrator assigns their Teacher or Student role.':
    'Thêm mọi người sau khi tài khoản đã tồn tại và quản trị viên đã chỉ định vai trò Giáo viên hoặc Học sinh.',
  'Registered account emails': 'Email tài khoản đã đăng ký',
  'One email per line, comma, or space':
    'Mỗi email một dòng, hoặc phân cách bằng dấu phẩy hay khoảng trắng',
  'Add up to 500 people per batch. You can repeat as needed.':
    'Thêm tối đa 500 người mỗi lượt và lặp lại khi cần.',
  'Add as': 'Thêm với vai trò',
  'Add to class': 'Thêm vào lớp',
  'Adding…': 'Đang thêm…',
  'Check these email entries': 'Kiểm tra các email này',
  'Use 500 or fewer emails in each batch.':
    'Dùng tối đa 500 email trong mỗi lượt.',
  '{count} people added': 'Đã thêm {count} người',
  '{count} already in this class': '{count} người đã có trong lớp',
  'Roster update complete': 'Đã cập nhật danh sách lớp',
  'Every account was checked against its classroom role.':
    'Mỗi tài khoản đã được kiểm tra theo vai trò lớp học.',
  Added: 'Đã thêm',
  'Already here': 'Đã có trong lớp',
  'Role mismatch': 'Sai vai trò',
  'Review accounts that need attention': 'Xem các tài khoản cần xử lý',
  'Wrong Admin-assigned role':
    'Vai trò do quản trị viên chỉ định không phù hợp',
  'Account not found or unavailable':
    'Không tìm thấy tài khoản hoặc tài khoản không khả dụng',
  'Class roster': 'Danh sách lớp',
  'Everyone in this class': 'Mọi người trong lớp',
  'Find a person': 'Tìm một người',
  'Search name, email, or account ID': 'Tìm tên, email hoặc ID tài khoản',
  'Show role': 'Hiển thị vai trò',
  Everyone: 'Tất cả mọi người',
  shown: 'đang hiển thị',
  'No people match this view': 'Không có người phù hợp với chế độ xem này',
  'Try another name or role.': 'Thử tên hoặc vai trò khác.',
  Person: 'Người dùng',
  Role: 'Vai trò',
  'Account ID': 'ID tài khoản',
  'Student join code': 'Mã tham gia cho Học sinh',
  'Create 7-day Student join code': 'Tạo mã tham gia 7 ngày cho Học sinh',
  'Only an account assigned as Student can use this code.':
    'Chỉ tài khoản được chỉ định là Học sinh mới dùng được mã này.',
  'Smaller circles': 'Các nhóm nhỏ',
  'Organize students for focused activities and shared join codes.':
    'Sắp xếp học sinh cho hoạt động tập trung và mã tham gia chung.',
  'Organize rostered students for focused activities.':
    'Sắp xếp học sinh trong danh sách lớp cho các hoạt động tập trung.',
  'e.g. Studio A': 'ví dụ: Nhóm A',
  'Resource count': 'Số tài nguyên',
  'Ready to add': 'Sẵn sàng để thêm',
  'All classes': 'Tất cả lớp học',
  'Showing work from': 'Hiển thị bài từ',
  'All clear': 'Đã hoàn tất',
  'Class folio': 'Hồ sơ lớp học',
  '{count} activity': '{count} hoạt động',
  '{count} activities': '{count} hoạt động',
  'Open activity': 'Mở hoạt động',
  'When a Teacher opens a Run for you, it will appear here.':
    'Khi Giáo viên mở một đợt thực hiện cho bạn, nội dung sẽ xuất hiện tại đây.',
  'Your Teacher-published work appears in the Assigned view.':
    'Bài tập do Giáo viên xuất bản sẽ xuất hiện trong mục Được giao.',
  'Resources, activities, and people for this class.':
    'Tài nguyên, hoạt động và mọi người trong lớp học này.',
  'Your Teacher has not shared class resources yet.':
    'Giáo viên chưa chia sẻ tài nguyên lớp học.',
  'Previous work': 'Công việc trước đó',
  verifying: 'đang xác minh',
  'View task trail': 'Xem dấu vết tác vụ',
  'Work through one smaller example step by step, explain why each operation is valid, then retry the assignment problem.':
    'Làm từng bước với một ví dụ nhỏ hơn, giải thích vì sao mỗi phép toán hợp lý, rồi thử lại bài tập.',
  'Outline the claim, evidence, and explanation first; draft one paragraph, then revise it with feedback.':
    'Trước tiên hãy lập dàn ý cho luận điểm, bằng chứng và phần giải thích; viết nháp một đoạn rồi chỉnh sửa theo phản hồi.',
  'List what is known, name the concept or formula that connects it, and test it on one simpler example.':
    'Liệt kê dữ kiện đã biết, xác định khái niệm hoặc công thức kết nối chúng, rồi kiểm tra bằng một ví dụ đơn giản hơn.',
  'Break the assignment into one smaller question, explain the first step in your own words, then practise a similar example.':
    'Chia bài tập thành một câu hỏi nhỏ hơn, tự giải thích bước đầu tiên, rồi luyện tập với một ví dụ tương tự.',
  Personalization: 'Cá nhân hóa',
  'Custom companion': 'Bạn đồng hành tùy chỉnh',
  'Start with any picture, choose a style, then preview your tiny cursor companion.':
    'Bắt đầu bằng một bức ảnh, chọn phong cách, rồi xem trước bạn đồng hành nhỏ bên con trỏ.',
  'Getting your companion ready…': 'Đang chuẩn bị bạn đồng hành…',
  Active: 'Đang dùng',
  'Following your cursor now': 'Đang đi theo con trỏ',
  'All previews used this month': 'Đã dùng hết lượt xem trước tháng này',
  'You can create more on {date}. Your current companion stays active.':
    'Bạn có thể tạo thêm vào {date}. Bạn đồng hành hiện tại vẫn hoạt động.',
  'Choose a picture': 'Chọn một bức ảnh',
  'A pet, drawing, character, or anything that feels like you.':
    'Thú cưng, tranh vẽ, nhân vật hoặc bất cứ điều gì thể hiện bạn.',
  'Picture ready': 'Ảnh đã sẵn sàng',
  'Drop, paste, or click to choose': 'Thả, dán hoặc bấm để chọn',
  'Click to choose another': 'Bấm để chọn ảnh khác',
  'PNG or JPEG · up to 5 MiB': 'PNG hoặc JPEG · tối đa 5 MiB',
  Change: 'Đổi',
  Browse: 'Chọn ảnh',
  'Describe the vibe': 'Mô tả phong cách',
  'Try a style, mood, and a few colors.':
    'Thử nêu phong cách, cảm xúc và một vài màu sắc.',
  'Your idea': 'Ý tưởng của bạn',
  'A cheerful pixel-art fox in sunny yellow and orange':
    'Một chú cáo pixel vui vẻ với màu vàng nắng và cam',
  'Ready for a first look?': 'Sẵn sàng xem thử chưa?',
  '{used} of {limit} previews used · resets {date}':
    'Đã dùng {used} trên {limit} lượt xem trước · đặt lại vào {date}',
  'Creating your preview…': 'Đang tạo bản xem trước…',
  'Add an image to continue': 'Thêm ảnh để tiếp tục',
  'Describe a style to continue': 'Mô tả phong cách để tiếp tục',
  'This can take up to 2 minutes. Keep Tro open.':
    'Quá trình này có thể mất đến 2 phút. Hãy để Tro mở.',
  'Private by design': 'Riêng tư ngay từ thiết kế',
  'Sent once to OpenAI; your source and prompt are not saved by Tro.':
    'Chỉ gửi một lần đến OpenAI; Tro không lưu ảnh nguồn và lời nhắc của bạn.',
  'Privacy and monthly slots': 'Quyền riêng tư và lượt dùng hàng tháng',
  'Meet your new companion': 'Gặp bạn đồng hành mới',
  'Nothing changes until you choose to use it.':
    'Sẽ không có gì thay đổi cho đến khi bạn chọn sử dụng.',
  'Preview ready': 'Bản xem trước đã sẵn sàng',
  'Made for your cursor': 'Dành riêng cho con trỏ của bạn',
  'Turn an image into a small custom companion that follows your cursor in Tro.':
    'Biến một hình ảnh thành bạn đồng hành nhỏ đi theo con trỏ của bạn trong Tro.',
  '{remaining} of {limit} left this month':
    'Còn {remaining} trên {limit} trong tháng này',
  'Loading companion settings…': 'Đang tải cài đặt bạn đồng hành…',
  'Current companion': 'Bạn đồng hành hiện tại',
  'Your custom companion is active.':
    'Bạn đồng hành tùy chỉnh của bạn đang hoạt động.',
  'Tro’s default companion is active.':
    'Bạn đồng hành mặc định của Tro đang hoạt động.',
  'Use default companion': 'Dùng bạn đồng hành mặc định',
  'Pick a pet': 'Chọn thú cưng',
  'Choose Tro or a pet you generated. Switching does not use a preview.':
    'Chọn Tro hoặc thú cưng bạn đã tạo. Việc chuyển đổi không tốn lượt xem trước.',
  '{count} custom pets': '{count} thú cưng tùy chỉnh',
  'Tro, active': 'Tro, đang dùng',
  'Use Tro': 'Dùng Tro',
  'Animated default pet': 'Thú cưng mặc định có hoạt ảnh',
  'Generated pet {number}': 'Thú cưng đã tạo {number}',
  '{name}, active': '{name}, đang dùng',
  'Use {name}': 'Dùng {name}',
  'Created {date}': 'Đã tạo {date}',
  'Switching…': 'Đang chuyển…',
  Use: 'Dùng',
  'Generated pets stay encrypted on this device.':
    'Các thú cưng đã tạo được mã hóa trên thiết bị này.',
  'Create your own pet': 'Tạo thú cưng riêng',
  'Start with a picture, then describe how your pet should look.':
    'Bắt đầu bằng một bức ảnh, rồi mô tả diện mạo bạn muốn cho thú cưng.',
  'Generated pets keep Tro’s state badges and motion reactions.':
    'Thú cưng đã tạo vẫn dùng huy hiệu trạng thái và phản ứng chuyển động của Tro.',
  'Restoring…': 'Đang khôi phục…',
  'Generation unavailable': 'Không thể tạo hình',
  'Add a source image': 'Thêm ảnh nguồn',
  'Paste, drop, or choose a PNG or JPEG up to 5 MiB.':
    'Dán, thả hoặc chọn ảnh PNG hay JPEG tối đa 5 MiB.',
  'Choose image': 'Chọn ảnh',
  'Choose a PNG or JPEG image.': 'Hãy chọn ảnh PNG hoặc JPEG.',
  'Choose an image no larger than 5 MiB.': 'Hãy chọn ảnh không lớn hơn 5 MiB.',
  'Selected source': 'Ảnh nguồn đã chọn',
  'How should Tro customize it?': 'Bạn muốn Tro tùy chỉnh ảnh thế nào?',
  'For example: a cheerful pixel-art fox with a transparent background':
    'Ví dụ: một chú cáo pixel vui vẻ với nền trong suốt',
  '{count} of 400 characters': '{count} trên 400 ký tự',
  '{used} of {limit} generations used this month. Resets {date}.':
    'Đã dùng {used} trên {limit} lượt tạo trong tháng này. Đặt lại vào {date}.',
  'Your source image and prompt are sent to OpenAI only for this generation; Tro does not save them. A companion you activate stays encrypted on this device. OpenAI may retain images flagged for child-safety review. An uncertain provider outcome may use one monthly slot, and Tro will not retry it automatically.':
    'Ảnh nguồn và lời nhắc chỉ được gửi đến OpenAI cho lượt tạo này; Tro không lưu chúng. Bạn đồng hành được kích hoạt sẽ lưu ở dạng mã hóa trên thiết bị này. OpenAI có thể lưu ảnh bị đánh dấu để xem xét an toàn trẻ em. Một kết quả không chắc chắn từ nhà cung cấp có thể dùng một lượt trong tháng và Tro sẽ không tự động thử lại.',
  'Generating… this can take up to 2 minutes':
    'Đang tạo… quá trình này có thể mất đến 2 phút',
  'Monthly limit reached': 'Đã đạt giới hạn tháng',
  'Generate preview': 'Tạo bản xem trước',
  'Generated preview': 'Bản xem trước đã tạo',
  'Preview available until {time}.': 'Bản xem trước có hiệu lực đến {time}.',
  'Use this companion': 'Dùng bạn đồng hành này',
  'Tro could not read this image.': 'Tro không thể đọc ảnh này.',
  'Manage Tro’s companion, interface language, voice input, and installed application.':
    'Quản lý bạn đồng hành, ngôn ngữ giao diện, nhập liệu bằng giọng nói và ứng dụng Tro đã cài đặt.',
  'Create up to five cursor companions each month.':
    'Tạo tối đa năm bạn đồng hành con trỏ mỗi tháng.',
  'Companion generation is not available for this account.':
    'Tính năng tạo bạn đồng hành không khả dụng cho tài khoản này.',
  'Companion image generation is disabled.':
    'Tính năng tạo ảnh bạn đồng hành đang tắt.',
  Organization: 'Tổ chức',
  'Organization settings': 'Cài đặt tổ chức',
  'Organization access': 'Quyền truy cập tổ chức',
  'Organization profile': 'Hồ sơ tổ chức',
  'Organization name': 'Tên tổ chức',
  'Organization name was not saved': 'Chưa lưu được tên tổ chức',
  'Organization name must be between 1 and 100 characters.':
    'Tên tổ chức phải có từ 1 đến 100 ký tự.',
  'Organization name is already up to date.': 'Tên tổ chức đã được cập nhật.',
  'Organization name saved.': 'Đã lưu tên tổ chức.',
  'Tro could not save the organization name.': 'Tro không thể lưu tên tổ chức.',
  'Save name': 'Lưu tên',
  'Saving name…': 'Đang lưu tên…',
  '{count} of 100 characters': '{count} trên 100 ký tự',
  Member: 'Thành viên',
  'Manage your organization profile and access seats.':
    'Quản lý hồ sơ tổ chức và các chỗ truy cập.',
  'View the organization that manages your Tro access.':
    'Xem tổ chức đang quản lý quyền truy cập Tro của bạn.',
  'Managed access': 'Quyền truy cập được quản lý',
  'Your access is managed by this organization':
    'Quyền truy cập của bạn do tổ chức này quản lý',
  'You joined automatically with your verified Google email. You do not need to enter the organization code.':
    'Bạn đã tự động tham gia bằng email Google đã xác minh. Bạn không cần nhập mã của tổ chức.',
  'Manage organization': 'Quản lý tổ chức',
  'Loading organization…': 'Đang tải tổ chức…',
  'No organization to manage': 'Không có tổ chức để quản lý',
  'This account does not manage an organization access code.':
    'Tài khoản này không quản lý mã truy cập của tổ chức.',
  Refresh: 'Làm mới',
  Organizer: 'Người tổ chức',
  'Reserve seats by email. Members join automatically when they sign in with that address.':
    'Giữ chỗ bằng email. Thành viên sẽ tự động tham gia khi đăng nhập bằng địa chỉ đó.',
  'Organization refresh failed': 'Không thể làm mới tổ chức',
  'All seats are assigned': 'Tất cả chỗ đã được phân bổ',
  'Cancel a pending reservation before adding another person.':
    'Hủy một chỗ đang chờ trước khi thêm người khác.',
  'Access capacity': 'Sức chứa truy cập',
  'Access seats': 'Chỗ truy cập',
  '{assigned} of {maximum} seats assigned':
    'Đã phân bổ {assigned} trên {maximum} chỗ',
  '{remaining} remaining': 'Còn {remaining} chỗ',
  '{percent}% of seats assigned': 'Đã phân bổ {percent}% số chỗ',
  'Invite a student or staff member': 'Mời học sinh hoặc nhân viên',
  'Google account email': 'Email tài khoản Google',
  'student@example.com': 'hocsinh@example.com',
  'Reserve the exact Google account email. Tro does not send an invitation email, and the person does not need your organization code. They join automatically when they sign in.':
    'Giữ chỗ bằng đúng email tài khoản Google. Tro không gửi email mời và người đó không cần mã tổ chức của bạn. Họ sẽ tự động tham gia khi đăng nhập.',
  'Reserving…': 'Đang giữ chỗ…',
  'Reserve seat': 'Giữ chỗ',
  '{count} assigned seats': '{count} chỗ đã phân bổ',
  'Refreshing…': 'Đang làm mới…',
  'Loading members…': 'Đang tải thành viên…',
  'No seats have been assigned yet.': 'Chưa có chỗ nào được phân bổ.',
  'Joined {date}': 'Đã tham gia {date}',
  'Reserved {date}': 'Đã giữ chỗ {date}',
  Pending: 'Đang chờ',
  'Cancelling…': 'Đang hủy…',
  'Cancel reservation': 'Hủy chỗ',
  'Load more': 'Tải thêm',
  'Seat reserved for {email}.': 'Đã giữ chỗ cho {email}.',
  '{email} already has a reserved seat.': '{email} đã có chỗ được giữ.',
  'The reserved seat for {email} was cancelled.':
    'Đã hủy chỗ được giữ cho {email}.',
  'Tro could not load organization members.':
    'Tro không thể tải thành viên tổ chức.',
  'Tro could not reserve this seat.': 'Tro không thể giữ chỗ này.',
  'Tro could not cancel this reserved seat.':
    'Tro không thể hủy chỗ được giữ này.',
  Plan: 'Gói',
  'Assigned seats': 'Chỗ đã phân bổ',
  '{assigned} of {maximum}': '{assigned} trên {maximum}',
  'Open organization settings': 'Mở cài đặt tổ chức',
  'Manage your organization name and reserve seats by email. Students sign in with that address and do not need your code.':
    'Quản lý tên tổ chức và giữ chỗ bằng email. Học sinh đăng nhập bằng địa chỉ đó và không cần mã của bạn.',
  'Your Tro access is managed by this organization. You do not need to enter its access code.':
    'Quyền truy cập Tro của bạn do tổ chức này quản lý. Bạn không cần nhập mã truy cập của tổ chức.',
  'Next step: class enrollment': 'Bước tiếp theo: ghi danh vào lớp',
  'Add active students to a class separately':
    'Thêm riêng học sinh đang hoạt động vào lớp',
  'An organization seat provides Tro access, but it does not enroll someone in a class.':
    'Chỗ trong tổ chức cấp quyền truy cập Tro nhưng không ghi danh người đó vào lớp.',
  'After the account exists and has the Student role, open Class workspaces, choose the class, then use People to add them.':
    'Sau khi tài khoản tồn tại và có vai trò Học sinh, hãy mở Không gian lớp học, chọn lớp rồi dùng mục Mọi người để thêm họ.',
  'Open Class workspaces': 'Mở Không gian lớp học',
  'Home announcement': 'Thông báo trang chủ',
  'Organization home banner': 'Biểu ngữ trang chủ của tổ chức',
  'Upload one image for your organization. It replaces the Tro artwork when members open the Agent home screen, and the default returns whenever you remove it.':
    'Tải lên một hình ảnh cho tổ chức. Hình này thay thế hình Tro khi thành viên mở trang chủ Trợ lý; hình mặc định sẽ trở lại khi bạn xóa hình tùy chỉnh.',
  'PNG, JPEG, or WebP · maximum 750 KB': 'PNG, JPEG hoặc WebP · tối đa 750 KB',
  'Organization home banner preview':
    'Bản xem trước biểu ngữ trang chủ của tổ chức',
  'Default Tro banner': 'Biểu ngữ Tro mặc định',
  'Choose another image': 'Chọn hình ảnh khác',
  'Choose an image': 'Chọn hình ảnh',
  'Save banner': 'Lưu biểu ngữ',
  'Saving banner…': 'Đang lưu biểu ngữ…',
  'Use default Tro banner': 'Dùng biểu ngữ Tro mặc định',
  'Choose a PNG, JPEG, or WebP image no larger than 750 KB.':
    'Chọn ảnh PNG, JPEG hoặc WebP không lớn hơn 750 KB.',
  'Home banner saved for this organization.':
    'Đã lưu biểu ngữ trang chủ cho tổ chức này.',
  'The default Tro banner is active.': 'Biểu ngữ Tro mặc định đang được dùng.',
  'Home banner was not saved': 'Chưa lưu được biểu ngữ trang chủ',
  'Tro could not save the home banner.':
    'Tro không thể lưu biểu ngữ trang chủ.',
  'Tro could not restore the default banner.':
    'Tro không thể khôi phục biểu ngữ mặc định.',
  'Announcement from {organization}': 'Thông báo từ {organization}',
  'your organization': 'tổ chức của bạn',
  Complete: 'Hoàn tất',
  'Current application': 'Ứng dụng hiện tại',
  'Lets Tro insert Dictation into another app. Full computer use also needs Screen Recording.':
    'Cho phép Tro chèn nội dung Chính tả vào ứng dụng khác. Tính năng điều khiển máy tính đầy đủ còn cần quyền Ghi màn hình.',
  'Lets full computer use see the screen and verify its work. Dictation does not need it.':
    'Cho phép tính năng điều khiển máy tính xem màn hình và xác minh công việc. Chính tả không cần quyền này.',
  'Lets you dictate text or give Tro a voice Task.':
    'Cho phép bạn đọc chính tả hoặc giao Tác vụ cho Tro bằng giọng nói.',
  'Text tasks work without microphone or computer permissions. Dictation and voice Tasks use the microphone; inserting Dictation into another app also uses Accessibility.':
    'Tác vụ văn bản không cần quyền micrô hay máy tính. Chính tả và Tác vụ giọng nói dùng micrô; chèn Chính tả vào ứng dụng khác còn dùng quyền Trợ năng.',
  'Tro composer': 'Trình soạn thảo Tro',
  'Tro task': 'Tác vụ Tro',
  'Type, dictate, or give Tro a voice task…':
    'Nhập, đọc chính tả hoặc giao việc cho Tro bằng giọng nói…',
};

const CLASSROOM_VIETNAMESE_TRANSLATIONS: Readonly<Record<string, string>> = {
  'Activity blueprint': 'Bản thiết kế hoạt động',
  'Activity controls': 'Điều khiển hoạt động',
  'Attempt withdrawn': 'Lượt làm bài đã được rút lại',
  'Activity preparation steps': 'Các bước chuẩn bị hoạt động',
  'Activity published. Ready to open a room.':
    'Đã xuất bản hoạt động. Sẵn sàng mở phòng.',
  'Add a note for Tro': 'Thêm ghi chú cho Tro',
  'Add class material': 'Thêm tài liệu lớp học',
  'Add material, publish an Activity, then open a live room your students can join.':
    'Thêm tài liệu, xuất bản Hoạt động, rồi mở phòng trực tiếp để học sinh tham gia.',
  'Advisory feedback, never an automatic grade':
    'Phản hồi tham khảo, không bao giờ tự động chấm điểm',
  'Allow students to join a live room':
    'Cho phép học sinh tham gia phòng trực tiếp',
  'Approved site · eligible for student opt-in auto-open':
    'Trang đã duyệt · có thể tự mở khi học sinh đồng ý',
  'Approved sites for automatic opening': 'Các trang được phép tự động mở',
  'Asked at {time}': 'Đã hỏi lúc {time}',
  'Asking…': 'Đang yêu cầu…',
  'Attach check criteria': 'Đính kèm tiêu chí kiểm tra',
  'Available when class starts': 'Có sau khi bắt đầu lớp',
  'Begin or continue the exercise': 'Bắt đầu hoặc tiếp tục bài tập',
  'Bound Tro’s guidance': 'Giới hạn hướng dẫn của Tro',
  'Broadcast #{sequence} sent': 'Đã gửi thông báo #{sequence}',
  'Broadcast is class-wide': 'Thông báo sẽ gửi cho cả lớp',
  'Broadcast to class': 'Gửi cho cả lớp',
  'Broadcasting…': 'Đang gửi…',
  'Build the bounded source set Tro can use for this class.':
    'Xây dựng bộ nguồn giới hạn mà Tro được dùng cho lớp này.',
  'Check criteria': 'Tiêu chí kiểm tra',
  'Check my work': 'Kiểm tra bài của tôi',
  'Checking…': 'Đang kiểm tra…',
  'Choose files': 'Chọn tệp',
  'Choose folder': 'Chọn thư mục',
  'Choose the intent. Tro uses this Activity’s instructions, criteria, and published sources.':
    'Chọn mục đích. Tro sẽ dùng hướng dẫn, tiêu chí và nguồn đã xuất bản của Hoạt động này.',
  'Class ended': 'Lớp đã kết thúc',
  'Class live': 'Lớp đang diễn ra',
  'Class pulse': 'Nhịp lớp học',
  Classwork: 'Bài trên lớp',
  'Class sourcebook': 'Bộ nguồn lớp học',
  'Class context is active. Tro knows the published exercise when you ask for help.':
    'Ngữ cảnh lớp đang hoạt động. Tro biết bài tập đã xuất bản khi bạn yêu cầu trợ giúp.',
  Complete: 'Hoàn tất',
  'Continue where you left off': 'Tiếp tục từ chỗ bạn dừng lại',
  'Could not broadcast this direction.': 'Không thể gửi chỉ dẫn này.',
  'Could not close room admission.': 'Không thể đóng quyền tham gia phòng.',
  'Could not create a room code.': 'Không thể tạo mã phòng.',
  'Could not create this Run.': 'Không thể tạo lượt học này.',
  'Could not join this class room.': 'Không thể tham gia phòng học này.',
  'Could not leave this class.': 'Không thể rời lớp học này.',
  'Could not mark this work ready.': 'Không thể đánh dấu bài đã sẵn sàng.',
  'Could not open this link.': 'Không thể mở liên kết này.',
  'Could not resolve this help request.':
    'Không thể đánh dấu yêu cầu trợ giúp đã xử lý.',
  'Could not start classroom support.': 'Không thể bắt đầu hỗ trợ trong lớp.',
  'Could not update link permission.': 'Không thể cập nhật quyền mở liên kết.',
  'Could not update the class state.': 'Không thể cập nhật trạng thái lớp.',
  'Could not update this review.': 'Không thể cập nhật kết quả xem xét.',
  'Create 7-day invite': 'Tạo lời mời 7 ngày',
  'Create a code, then display or read it to your students.':
    'Tạo mã rồi hiển thị hoặc đọc mã cho học sinh.',
  'Create a teaching Space': 'Tạo Không gian giảng dạy',
  'Create a teaching Space or join a class room above.':
    'Tạo Không gian giảng dạy hoặc tham gia phòng học ở trên.',
  'Create room code': 'Tạo mã phòng',
  'Create room lobby': 'Tạo phòng chờ',
  'Create teaching Space': 'Tạo Không gian giảng dạy',
  'Creating…': 'Đang tạo…',
  'Current class direction': 'Chỉ dẫn hiện tại của lớp',
  'Current class session': 'Phiên học hiện tại',
  'Current direction': 'Chỉ dẫn hiện tại',
  'Current teacher direction': 'Chỉ dẫn hiện tại từ giáo viên',
  'Delivery method': 'Cách giao bài',
  'Direct assignment': 'Giao bài trực tiếp',
  'Direction type': 'Loại chỉ dẫn',
  Dismiss: 'Bỏ qua',
  'End class safely': 'Kết thúc lớp an toàn',
  'Ending…': 'Đang kết thúc…',
  'Enter a valid public HTTPS link': 'Nhập liên kết HTTPS công khai hợp lệ',
  'Enter the room code from your teacher. Tro will wait with you until class starts.':
    'Nhập mã phòng từ giáo viên. Tro sẽ chờ cùng bạn cho đến khi lớp bắt đầu.',
  'Every Attempt, in one calm place.':
    'Mọi lượt làm bài, trong một nơi gọn gàng.',
  'Every automatic action stays explicit and revocable':
    'Mọi hành động tự động đều rõ ràng và có thể thu hồi',
  'Exact student preview': 'Bản xem trước chính xác cho học sinh',
  Exercise: 'Bài tập',
  'Expires at {time}': 'Hết hạn lúc {time}',
  'Explicit class signals': 'Tín hiệu rõ ràng từ lớp học',
  'Explicit hand-in': 'Nộp bài chủ động',
  'Explicit lifecycle events only': 'Chỉ các sự kiện vòng đời rõ ràng',
  'Explicit status': 'Trạng thái rõ ràng',
  'Files leaving this device': 'Các tệp sẽ rời thiết bị này',
  'Filter classwork': 'Lọc bài trên lớp',
  'For students': 'Dành cho học sinh',
  'For teachers': 'Dành cho giáo viên',
  'Frame the exercise': 'Định hình bài tập',
  'Groups are for recurring assignments. Live rooms can admit students without a prebuilt list.':
    'Nhóm dùng cho bài tập lặp lại. Phòng trực tiếp cho phép học sinh tham gia mà không cần danh sách có sẵn.',
  'Have a longer Space invite code?': 'Bạn có mã mời Không gian dài hơn?',
  'Help requested': 'Đã yêu cầu trợ giúp',
  'Help stays inside the published material and policy':
    'Trợ giúp luôn nằm trong tài liệu và chính sách đã xuất bản',
  'How will students begin?': 'Học sinh sẽ bắt đầu như thế nào?',
  'I’m ready for review': 'Tôi đã sẵn sàng để giáo viên xem',
  'Immutable version': 'Phiên bản bất biến',
  'Invite the room': 'Mời cả lớp vào phòng',
  'Invite the room, set the current direction, and review explicit student signals in one place.':
    'Mời cả lớp, đặt chỉ dẫn hiện tại và xem các tín hiệu rõ ràng của học sinh tại một nơi.',
  'Join · Work · Help · Check · Submit':
    'Tham gia · Làm bài · Trợ giúp · Kiểm tra · Nộp bài',
  'Join a room from Knowledge Spaces or wait for your teacher to assign an Activity.':
    'Tham gia phòng từ Không gian kiến thức hoặc chờ giáo viên giao Hoạt động.',
  'Join room': 'Tham gia phòng',
  'Join your class': 'Tham gia lớp học',
  'Joining creates each student’s private Attempt.':
    'Khi tham gia, mỗi học sinh có một lượt làm bài riêng tư.',
  'Joining…': 'Đang tham gia…',
  Leave: 'Rời lớp',
  'Leaving…': 'Đang rời lớp…',
  'Links never broadcast or open until you confirm the preview.':
    'Liên kết không được gửi hoặc mở cho đến khi bạn xác nhận bản xem trước.',
  'Live class': 'Lớp trực tiếp',
  'Live classroom control': 'Điều khiển lớp học trực tiếp',
  'Live room': 'Phòng trực tiếp',
  'Loading Activity…': 'Đang tải Hoạt động…',
  'Loading materials…': 'Đang tải tài liệu…',
  'Manual delivery': 'Mở thủ công',
  'Mark resolved': 'Đánh dấu đã xử lý',
  'Marking ready…': 'Đang đánh dấu sẵn sàng…',
  'Material type': 'Loại tài liệu',
  Material: 'Tài liệu',
  material: 'tài liệu',
  materials: 'tài liệu',
  Materials: 'Tài liệu',
  'Material count': 'Số tài liệu',
  'Class materials': 'Tài liệu lớp học',
  'Class workspace sections': 'Các mục trong không gian lớp học',
  'For every activity': 'Dùng cho mọi hoạt động',
  'Add the class material Tro should use when supporting assigned Activities.':
    'Thêm tài liệu lớp học mà Tro nên dùng khi hỗ trợ các Hoạt động được giao.',
  'Materials your Teacher shared to support assigned Activities.':
    'Tài liệu Giáo viên chia sẻ để hỗ trợ các Hoạt động được giao.',
  'Add files': 'Thêm tệp',
  'Add a folder': 'Thêm thư mục',
  'Upload options': 'Tùy chọn tải lên',
  'Reference by default': 'Mặc định là Tài liệu tham khảo',
  'Use these materials as': 'Dùng những tài liệu này làm',
  'Reference is the safest default. Choose another type only when the material has a specific job.':
    'Tài liệu tham khảo là lựa chọn mặc định an toàn. Chỉ chọn loại khác khi tài liệu có mục đích cụ thể.',
  'Adding as {type}': 'Đang thêm dưới dạng {type}',
  'Review selection': 'Xem lại lựa chọn',
  'Only these files will be added to class materials.':
    'Chỉ những tệp này sẽ được thêm vào tài liệu lớp học.',
  'Selected file count': 'Số tệp đã chọn',
  'Add selected files': 'Thêm các tệp đã chọn',
  'Checking what this class already has.':
    'Đang kiểm tra tài liệu hiện có của lớp.',
  'Nothing shared yet': 'Chưa có nội dung được chia sẻ',
  'Start with what you teach': 'Bắt đầu từ nội dung bạn giảng dạy',
  'No class materials yet': 'Chưa có tài liệu lớp học',
  'Bring in your first material': 'Thêm tài liệu đầu tiên',
  'Your Teacher has not shared class materials yet.':
    'Giáo viên chưa chia sẻ tài liệu lớp học.',
  'Add notes, readings, or starter files so Tro can support students with the right context.':
    'Thêm ghi chú, bài đọc hoặc tệp khởi đầu để Tro hỗ trợ học sinh với đúng ngữ cảnh.',
  'Used as': 'Dùng làm',
  'Materials are unavailable.': 'Không thể tải tài liệu.',
  'Materials and activities shared with this class.':
    'Tài liệu và hoạt động được chia sẻ với lớp học này.',
  'Pending upload': 'Đang chờ tải lên',
  Processing: 'Đang xử lý',
  Ready: 'Sẵn sàng',
  Failed: 'Không thành công',
  Pending: 'Đang chờ',
  '{role}; status {status}': '{role}; trạng thái {status}',
  'Move forward without losing context': 'Tiếp tục mà không mất ngữ cảnh',
  'Needs help now': 'Cần trợ giúp ngay',
  'New exercise from your teacher': 'Bài tập mới từ giáo viên',
  'Explanation request from your teacher': 'Yêu cầu giải thích từ giáo viên',
  'New link from your teacher': 'Liên kết mới từ giáo viên',
  'No shared material': 'Chưa có tài liệu được chia sẻ',
  'Nothing active right now': 'Hiện không có bài nào đang làm',
  'No classwork here yet': 'Chưa có bài trên lớp',
  'One HTTPS origin per line. Other safe links remain manual and always show an Open button.':
    'Mỗi dòng một nguồn HTTPS. Các liên kết an toàn khác vẫn mở thủ công và luôn hiện nút Mở.',
  'One criterion per line. Check uses these; it never assigns a numeric grade.':
    'Mỗi dòng một tiêu chí. Kiểm tra dùng các tiêu chí này và không bao giờ tự cho điểm số.',
  'One room. Everyone in context.': 'Một phòng. Mọi người cùng ngữ cảnh.',
  'Only joined, Help, Check, readiness, submission, and review events—never inferred attention or understanding.':
    'Chỉ ghi nhận tham gia, Trợ giúp, Kiểm tra, sẵn sàng, nộp bài và xem xét—không suy đoán sự chú ý hay mức độ hiểu.',
  'Only material published with your Activities is shared with you.':
    'Chỉ tài liệu được xuất bản cùng Hoạt động mới được chia sẻ với bạn.',
  'Only published HTTPS sites allowed by this Activity. You can turn this off anytime.':
    'Chỉ các trang HTTPS đã xuất bản và được Hoạt động cho phép. Bạn có thể tắt bất cứ lúc nào.',
  'Open a link': 'Mở liên kết',
  'Open a live room for class, or assign this version for independent work.':
    'Mở phòng trực tiếp cho lớp hoặc giao phiên bản này để học sinh tự làm.',
  'Open approved class links automatically':
    'Tự động mở liên kết lớp học đã duyệt',
  'Open assignment': 'Mở bài được giao',
  'Open classwork': 'Mở bài trên lớp',
  'Open link': 'Mở liên kết',
  'Open the published brief, continue your work, ask for Help, Check against criteria, or submit when you decide.':
    'Mở đề bài đã xuất bản, tiếp tục làm, yêu cầu Trợ giúp, Kiểm tra theo tiêu chí hoặc nộp khi bạn quyết định.',
  'Optional. Only published HTTPS sites for this Activity; change it anytime.':
    'Không bắt buộc. Chỉ các trang HTTPS đã xuất bản cho Hoạt động này; có thể thay đổi bất cứ lúc nào.',
  'People & groups': 'Người học và nhóm',
  'Pinned source versions': 'Các phiên bản nguồn đã ghim',
  'Prepare before class': 'Chuẩn bị trước giờ học',
  'Prepare material, publish a learning path, then invite the room.':
    'Chuẩn bị tài liệu, xuất bản lộ trình học, rồi mời cả lớp vào phòng.',
  'Prepare the learning path': 'Chuẩn bị lộ trình học',
  'Prepare · Broadcast · Review': 'Chuẩn bị · Gửi chỉ dẫn · Xem xét',
  'Preview exact broadcast': 'Xem trước thông báo chính xác',
  'Public HTTPS link': 'Liên kết HTTPS công khai',
  'Publish Activity': 'Xuất bản Hoạt động',
  'Publish one immutable version before you open a live room.':
    'Xuất bản một phiên bản bất biến trước khi mở phòng trực tiếp.',
  'Published and ready': 'Đã xuất bản và sẵn sàng',
  'Published brief': 'Đề bài đã xuất bản',
  'Published source set': 'Bộ nguồn đã xuất bản',
  'Raised explicitly by the student': 'Do học sinh chủ động yêu cầu',
  'Ready for review': 'Sẵn sàng để xem xét',
  Recommended: 'Được đề xuất',
  'Require an explicit file submission': 'Yêu cầu chủ động nộp tệp',
  'Resolving…': 'Đang xử lý…',
  Return: 'Trả lại',
  'Reusable cohorts': 'Nhóm học có thể tái sử dụng',
  'Review actions': 'Thao tác xem xét',
  'Review before upload': 'Xem lại trước khi tải lên',
  'Complete this exact Attempt?': 'Hoàn tất đúng lượt làm bài này?',
  'Return this exact Attempt for revision?':
    'Trả lại đúng lượt làm bài này để chỉnh sửa?',
  'Confirm Complete': 'Xác nhận hoàn tất',
  'Confirm Return': 'Xác nhận trả lại',
  'Updating…': 'Đang cập nhật…',
  Cancel: 'Hủy',
  Revise: 'Chỉnh sửa',
  Revoke: 'Thu hồi',
  'Role-aware by design': 'Thiết kế theo đúng vai trò',
  'Room code': 'Mã phòng',
  'Room lobby': 'Phòng chờ',
  'Rotate code': 'Đổi mã',
  'Safe link · students will choose Open':
    'Liên kết an toàn · học sinh sẽ chọn Mở',
  'Session visibility': 'Thông tin phiên được chia sẻ',
  'Set live-class permissions': 'Đặt quyền cho lớp trực tiếp',
  'Share the room code above. Joined students appear here without refreshing.':
    'Chia sẻ mã phòng ở trên. Học sinh đã tham gia sẽ xuất hiện tại đây mà không cần tải lại.',
  'Share this longer-lived code only with intended participants.':
    'Chỉ chia sẻ mã có thời hạn dài hơn này với người học phù hợp.',
  'Short-lived · up to 500 joins': 'Thời hạn ngắn · tối đa 500 lượt tham gia',
  'Space invite': 'Lời mời Không gian',
  'Space invite code': 'Mã mời Không gian',
  'Space name': 'Tên Không gian',
  'Space sections': 'Các mục trong Không gian',
  'Start class': 'Bắt đầu lớp',
  'Start together': 'Cùng bắt đầu',
  'Start working': 'Bắt đầu làm bài',
  'Student access': 'Quyền học sinh',
  'Student instructions': 'Hướng dẫn cho học sinh',
  'Student Space': 'Không gian học sinh',
  'Students join a lobby with one short code. You decide when class starts.':
    'Học sinh vào phòng chờ bằng một mã ngắn. Bạn quyết định khi nào lớp bắt đầu.',
  'Submission received. Your teacher can now review it.':
    'Đã nhận bài nộp. Giáo viên có thể xem ngay bây giờ.',
  'Submit files': 'Nộp tệp',
  'Submit files above': 'Nộp tệp ở phía trên',
  'Submit the required files above when your work is ready.':
    'Hãy nộp các tệp bắt buộc ở phía trên khi bài của bạn đã sẵn sàng.',
  'Submitted for review': 'Đã nộp để giáo viên xem xét',
  'Submitting…': 'Đang nộp…',
  'Takes less than a minute': 'Chưa đến một phút',
  'Teacher · Facilitator': 'Giáo viên · Người hướng dẫn',
  'Teacher · Owner': 'Giáo viên · Chủ sở hữu',
  'Teacher flow: Materials, Activity, Live room':
    'Quy trình giáo viên: Tài liệu, Hoạt động, Phòng trực tiếp',
  'Teachers can': 'Giáo viên có thể',
  'Teachers prepare the path. Students ask for help only when they need it. Tro keeps the published exercise in view.':
    'Giáo viên chuẩn bị lộ trình. Học sinh chỉ yêu cầu trợ giúp khi cần. Tro luôn giữ bài tập đã xuất bản trong ngữ cảnh.',
  'Tell the teacher and get one next step':
    'Báo cho giáo viên và nhận một bước tiếp theo',
  'Tell your teacher you are ready': 'Báo cho giáo viên rằng bạn đã sẵn sàng',
  'The room is closed. Student work remains saved.':
    'Phòng đã đóng. Bài của học sinh vẫn được lưu.',
  'This is explicit. Tro will not mark your work ready on its own.':
    'Đây là thao tác chủ động. Tro sẽ không tự đánh dấu bài đã sẵn sàng.',
  'Tro Classroom': 'Lớp học Tro',
  'Tro never uploads local work automatically.':
    'Tro không bao giờ tự động tải bài trên máy lên.',
  'Tro never uploads your local work automatically. You review the exact files before anything leaves your device.':
    'Tro không bao giờ tự động tải bài trên máy lên. Bạn xem đúng các tệp trước khi chúng rời thiết bị.',
  'Updated {date}': 'Cập nhật {date}',
  'Upload ready material in the Materials tab first.':
    'Hãy tải tài liệu sẵn sàng trong thẻ Tài liệu trước.',
  'Use starter': 'Dùng bộ khởi đầu',
  'Waiting for students': 'Đang chờ học sinh',
  'Waiting for teacher': 'Đang chờ giáo viên',
  'Waiting for teacher review': 'Đang chờ giáo viên xem xét',
  'What should every student do next?': 'Mọi học sinh nên làm gì tiếp theo?',
  'What students see and what success means':
    'Nội dung học sinh nhìn thấy và tiêu chí thành công',
  'What this session shares': 'Phiên này chia sẻ gì',
  'When you are satisfied': 'Khi bạn đã hài lòng',
  'Work with Tro': 'Làm bài cùng Tro',
  'Workspace required': 'Cần thư mục làm việc',
  'You are in. Tro will receive the exercise when your teacher starts class.':
    'Bạn đã vào phòng. Tro sẽ nhận bài tập khi giáo viên bắt đầu lớp.',
  'You can continue working if your teacher returns this Attempt.':
    'Bạn có thể tiếp tục nếu giáo viên trả lại lượt làm bài này.',
  'You can': 'Bạn có thể',
  'You receive only the Activity material assigned to you. Teacher uploads, publishing, room controls, and class-wide reporting are not available in the student view.':
    'Bạn chỉ nhận tài liệu Hoạt động được giao. Tải lên, xuất bản, điều khiển phòng và báo cáo toàn lớp không xuất hiện trong giao diện học sinh.',
  'Your classwork stays private': 'Bài trên lớp của bạn luôn riêng tư',
  'Your classwork': 'Bài trên lớp của bạn',
  'Your current and previous Attempts appear in Classwork in the sidebar.':
    'Các lượt làm bài hiện tại và trước đây nằm trong Bài trên lớp ở thanh bên.',
  'Your published class context and private Attempts live here.':
    'Ngữ cảnh lớp đã xuất bản và các lượt làm bài riêng tư của bạn nằm ở đây.',
  'Your sourcebook is empty': 'Bộ nguồn của bạn đang trống',
  'Your teacher can now review this Attempt.':
    'Giáo viên có thể xem lượt làm bài này ngay bây giờ.',
  'Your teacher can review the submitted snapshot.':
    'Giáo viên có thể xem bản chụp bài đã nộp.',
  'Your submitted snapshot is waiting for teacher review.':
    'Bản chụp bài đã nộp đang chờ giáo viên xem xét.',
  'Submission unavailable': 'Không thể nộp bài',
  'This Attempt is no longer active.': 'Lượt làm bài này không còn hoạt động.',
  'This Attempt is no longer active. Your prior work remains saved.':
    'Lượt làm bài này không còn hoạt động. Bài trước đó của bạn vẫn được lưu.',
  'Your work is private to you and your teachers.':
    'Bài của bạn chỉ hiển thị với bạn và giáo viên.',
  'Your work is still saved. This class session is no longer active.':
    'Bài của bạn vẫn được lưu. Phiên học này không còn hoạt động.',
  '{count} active Activities': '{count} Hoạt động đang thực hiện',
  '{count} check criteria attached': 'Đã đính kèm {count} tiêu chí kiểm tra',
  '{count} sources': '{count} nguồn',
  '{count} students in the lobby': '{count} học sinh trong phòng chờ',
  in_lobby: 'trong phòng chờ',
  launch_failed: 'khởi chạy thất bại',
  lobby: 'phòng chờ',
  working: 'đang làm bài',
  needs_help: 'cần trợ giúp',
  not_joined: 'chưa tham gia',
  ready: 'sẵn sàng',
  ready_for_review: 'sẵn sàng để xem xét',
  submitted: 'đã nộp',
  left: 'đã rời lớp',
  withdrawn: 'đã rút lại',
  'Auto-open eligible': 'Có thể tự động mở',
  'Could not start this Activity.': 'Không thể bắt đầu Hoạt động này.',
  'Opened in your browser': 'Đã mở trong trình duyệt',
  'Could not open this link': 'Không thể mở liên kết này',
  Dismissed: 'Đã bỏ qua',
  'Your teacher can see that you asked for help. Tro can guide your next step now.':
    'Giáo viên thấy rằng bạn đã yêu cầu trợ giúp. Tro có thể hướng dẫn bước tiếp theo ngay bây giờ.',
  'Your teacher can review this Attempt. You can still ask Tro to check another detail.':
    'Giáo viên có thể xem lượt làm bài này. Bạn vẫn có thể nhờ Tro kiểm tra thêm chi tiết.',
  'Your reviewed files were submitted and are waiting for teacher review.':
    'Các tệp bạn đã xem lại được nộp và đang chờ giáo viên xem.',
  'Your teacher completed this Attempt.':
    'Giáo viên đã hoàn tất lượt làm bài này.',
  'Only published HTTPS sites for this Activity; change it anytime.':
    'Chỉ các trang HTTPS đã xuất bản cho Hoạt động này; có thể thay đổi bất cứ lúc nào.',
  ' Join, Help, Check, submission, and review events only. No continuous cursor, typing, or screen monitoring.':
    ' Chỉ các sự kiện tham gia, Trợ giúp, Kiểm tra, nộp bài và xem xét. Không theo dõi liên tục con trỏ, thao tác gõ hay màn hình.',
  ' Students receive exactly this content. A model cannot press Broadcast for you.':
    ' Học sinh nhận đúng nội dung này. Mô hình không thể bấm Gửi thay bạn.',
  ' Tro may record bounded, provenance-labeled evidence candidates for teacher review. These cannot grade you or change completion state.':
    ' Tro có thể ghi lại các bằng chứng giới hạn, có nhãn nguồn để giáo viên xem. Chúng không thể chấm điểm hay thay đổi trạng thái hoàn thành.',
};

export function appLanguageLabel(language: AppLanguage): string {
  return (
    APP_LANGUAGE_OPTIONS.find((option) => option.code === language)?.label ??
    language
  );
}

export function appLocale(language: AppLanguage): string {
  return language === 'vi' ? 'vi-VN' : 'en-US';
}

export function translate(
  language: AppLanguage,
  message: string,
  replacements: Readonly<Record<string, string | number>> = {},
): string {
  let translated =
    language === 'vi'
      ? (VIETNAMESE_TRANSLATIONS[message] ??
        CLASSROOM_VIETNAMESE_TRANSLATIONS[message] ??
        message)
      : message;

  for (const [key, value] of Object.entries(replacements)) {
    translated = translated.replaceAll(`{${key}}`, String(value));
  }
  return translated;
}
