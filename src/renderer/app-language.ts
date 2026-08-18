import type { AppLanguage } from '../shared/contracts';

export const APP_LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'vi', label: 'Tiếng Việt' },
] as const satisfies ReadonlyArray<{
  code: AppLanguage;
  label: string;
}>;

const VIETNAMESE_TRANSLATIONS: Readonly<Record<string, string>> = {
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
  'A durable record of finished work, restored when you reopen TroCode.':
    'Bản ghi bền vững về công việc đã hoàn tất, được khôi phục khi bạn mở lại TroCode.',
  'A private, session-only view of how TroCode is working across your tasks.':
    'Góc nhìn riêng tư chỉ trong phiên về cách TroCode hoạt động trên các tác vụ của bạn.',
  'A useful assistant answer or an evidence-backed tool result.':
    'Câu trả lời hữu ích từ trợ lý hoặc kết quả công cụ có bằng chứng.',
  Act: 'Thực hiện',
  'A view of how TroCode is working across your saved tasks and lifecycle activity.':
    'Góc nhìn về cách TroCode hoạt động trên các tác vụ đã lưu và vòng đời của chúng.',
  'About TroCode': 'Về TroCode',
  'Access code': 'Mã truy cập',
  'Access required': 'Yêu cầu quyền truy cập',
  Accessibility: 'Trợ năng',
  act: 'thực hiện',
  'Activate membership': 'Kích hoạt tư cách thành viên',
  'Activate your TroCode membership': 'Kích hoạt tư cách thành viên TroCode',
  Activating: 'Đang kích hoạt',
  'Activating…': 'Đang kích hoạt…',
  'Activation code': 'Mã kích hoạt',
  acting: 'đang thực hiện',
  Action: 'Hành động',
  'Action approvals': 'Phê duyệt hành động',
  Activity: 'Hoạt động',
  Agent: 'Trợ lý',
  'App interface': 'Giao diện ứng dụng',
  'App language': 'Ngôn ngữ ứng dụng',
  'Application update': 'Cập nhật ứng dụng',
  'Approval gates enabled': 'Đã bật bước phê duyệt',
  'Approve exact action': 'Phê duyệt đúng hành động này',
  'Approval decisions': 'Quyết định phê duyệt',
  'Across sessions': 'Qua nhiều phiên',
  'Answer below by voice or text. Your response will continue this task.':
    'Trả lời bên dưới bằng giọng nói hoặc văn bản. Phản hồi của bạn sẽ tiếp tục tác vụ này.',
  Answer: 'Trả lời',
  answer: 'trả lời',
  'Answer TroCode to continue this task': 'Trả lời TroCode để tiếp tục tác vụ',
  'App controls will use {appLanguage}; new voice turns will use {spokenLanguage}.':
    'Giao diện ứng dụng sẽ dùng {appLanguage}; lượt nói mới sẽ dùng {spokenLanguage}.',
  'Acknowledge the Fully approved warning before saving.':
    'Hãy xác nhận cảnh báo Phê duyệt hoàn toàn trước khi lưu.',
  'Ask every time (recommended)': 'Hỏi mỗi lần (khuyên dùng)',
  'Assistant only': 'Chỉ dùng trợ lý',
  'Assistant-only tasks need no tools. Tool activity will appear here when used.':
    'Tác vụ chỉ dùng trợ lý không cần công cụ. Hoạt động công cụ sẽ xuất hiện ở đây khi được sử dụng.',
  'Best {count}d': 'Tốt nhất {count} ngày',
  blocked: 'bị chặn',
  'Bounded by default': 'Giới hạn theo mặc định',
  call: 'lần gọi',
  calls: 'lần gọi',
  cancelled: 'đã hủy',
  'Check for updates': 'Kiểm tra bản cập nhật',
  'Check again': 'Kiểm tra lại',
  'Checking…': 'Đang kiểm tra…',
  'Checking your membership…': 'Đang kiểm tra tư cách thành viên…',
  'Choose the language used for navigation, settings, and other TroCode controls.':
    'Chọn ngôn ngữ dùng cho điều hướng, cài đặt và các thành phần điều khiển khác của TroCode.',
  'Choose the default approval behavior for new tasks.':
    'Chọn cách phê duyệt mặc định cho các tác vụ mới.',
  'Choose how you talk with TroCode': 'Chọn cách bạn trò chuyện với TroCode',
  'Choose your spoken language, then give TroCode the macOS permissions it needs to hear your request, use the computer, and confirm the result. You stay in control and can revoke permissions in System Settings at any time.':
    'Chọn ngôn ngữ nói, sau đó cấp cho TroCode các quyền macOS cần thiết để nghe yêu cầu, sử dụng máy tính và xác nhận kết quả. Bạn luôn nắm quyền kiểm soát và có thể thu hồi quyền trong Cài đặt hệ thống bất cứ lúc nào.',
  'Collapse sidebar': 'Thu gọn thanh bên',
  'Compile or run a task and its behavior will appear here.':
    'Biên dịch hoặc chạy một tác vụ và cách hoạt động của tác vụ sẽ xuất hiện tại đây.',
  Connected: 'Đã kết nối',
  'Connect computer': 'Kết nối máy tính',
  Connecting: 'Đang kết nối',
  'Connecting…': 'Đang kết nối…',
  'Finishing your request…': 'Đang hoàn tất yêu cầu của bạn…',
  'Getting voice ready…': 'Đang chuẩn bị giọng nói…',
  'Connecting to OpenAI voice…': 'Đang kết nối với giọng nói OpenAI…',
  Conversation: 'Cuộc trò chuyện',
  completed: 'đã hoàn tất',
  'Completed, stopped, and unsuccessful tasks appear with their scope, conversation, and outcome.':
    'Các tác vụ đã hoàn thành, đã dừng hoặc chưa thành công sẽ xuất hiện cùng phạm vi, cuộc trò chuyện và kết quả.',
  'Computer use': 'Điều khiển máy tính',
  'Continue to TroCode': 'Tiếp tục vào TroCode',
  'Continue with access code': 'Tiếp tục bằng mã truy cập',
  Copy: 'Sao chép',
  Copied: 'Đã sao chép',
  'Current app session': 'Phiên ứng dụng hiện tại',
  Deny: 'Từ chối',
  Description: 'Mô tả',
  'Describe the outcome': 'Mô tả kết quả mong muốn',
  'Describe the finish line. TroCode will define a bounded scope, choose its tools, and verify the result.':
    'Mô tả đích đến. TroCode sẽ xác định phạm vi giới hạn, chọn công cụ và xác minh kết quả.',
  'Desktop agent': 'Trợ lý máy tính',
  'Downloading update…': 'Đang tải bản cập nhật…',
  Enabled: 'Đã bật',
  'Enable all permissions': 'Bật tất cả quyền',
  'Enable TroCode to work for you': 'Cho phép TroCode làm việc cho bạn',
  'Enter the access code provided by the TroCode team. Each account can use one code, and each code has a limited number of users.':
    'Nhập mã truy cập do đội ngũ TroCode cung cấp. Mỗi tài khoản chỉ có thể dùng một mã và mỗi mã có số lượng người dùng giới hạn.',
  'Enter your access code': 'Nhập mã truy cập của bạn',
  'Enter your TroCode access code': 'Nhập mã truy cập TroCode của bạn',
  'Expand sidebar': 'Mở rộng thanh bên',
  event: 'sự kiện',
  events: 'sự kiện',
  'EVENTS OBSERVED': 'SỰ KIỆN ĐÃ GHI NHẬN',
  'Example tasks': 'Tác vụ ví dụ',
  'Exact approval required': 'Cần phê duyệt chính xác',
  Execution: 'Thực thi',
  failed: 'thất bại',
  'Final setup step': 'Bước thiết lập cuối cùng',
  Finished: 'Đã kết thúc',
  'Fully approved': 'Phê duyệt hoàn toàn',
  'Finished task history': 'Lịch sử tác vụ đã kết thúc',
  'Finished tasks will settle here.': 'Tác vụ đã kết thúc sẽ xuất hiện ở đây.',
  'Finish setup': 'Hoàn tất thiết lập',
  'Finishing transcript…': 'Đang hoàn tất bản ghi âm…',
  'Finishing setup…': 'Đang hoàn tất thiết lập…',
  'General-purpose agent': 'Trợ lý đa năng',
  Guide: 'Hướng dẫn',
  guide: 'hướng dẫn',
  History: 'Lịch sử',
  'How TroCode helped': 'TroCode đã hỗ trợ như thế nào',
  'In motion': 'Đang thực hiện',
  Insights: 'Phân tích',
  'Insights overview': 'Tổng quan phân tích',
  'Interface language': 'Ngôn ngữ giao diện',
  'I understand consequential actions may run automatically.':
    'Tôi hiểu rằng các hành động có hậu quả có thể tự động chạy.',
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
  'Live activity': 'Hoạt động trực tiếp',
  'Live lifecycle': 'Vòng đời trực tiếp',
  'Live session': 'Phiên trực tiếp',
  'Live task': 'Tác vụ đang chạy',
  'Lifecycle activity': 'Hoạt động vòng đời',
  'Lifecycle events per day for the last six weeks':
    'Sự kiện vòng đời mỗi ngày trong sáu tuần qua',
  'Loading application update status…': 'Đang tải trạng thái cập nhật ứng dụng…',
  'Loading saved task history…': 'Đang tải lịch sử tác vụ đã lưu…',
  'Loading version…': 'Đang tải phiên bản…',
  'Loading…': 'Đang tải…',
  'Lets TroCode click, type, and control apps for you.':
    'Cho phép TroCode nhấp, nhập và điều khiển ứng dụng giúp bạn.',
  'Lets TroCode see the screen and verify its work.':
    'Cho phép TroCode xem màn hình và xác minh công việc.',
  'Lets you use push-to-talk voice commands.':
    'Cho phép bạn dùng lệnh giọng nói nhấn-để-nói.',
  'Manage TroCode’s interface language, voice input, and installed application.':
    'Quản lý ngôn ngữ giao diện, đầu vào giọng nói và ứng dụng TroCode đã cài đặt.',
  'Mute other audio while speaking': 'Tắt âm thanh khác khi đang nói',
  'Mute system output while you hold the voice shortcut, then restore its previous mute state when you release.':
    'Tắt âm thanh hệ thống khi bạn giữ phím tắt giọng nói, sau đó khôi phục trạng thái tắt tiếng trước đó khi bạn thả phím.',
  'New task': 'Tác vụ mới',
  'Needs attention': 'Cần chú ý',
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
  'OpenAI Realtime': 'OpenAI Realtime',
  'One-time setup': 'Thiết lập một lần',
  'Personal preferences': 'Tùy chọn cá nhân',
  Preferences: 'Tùy chọn',
  'Preferences saved. Approval changes apply to new tasks; app controls will use {appLanguage}, and new voice turns will use {spokenLanguage}.':
    'Đã lưu tùy chọn. Thay đổi phê duyệt áp dụng cho tác vụ mới; giao diện sẽ dùng {appLanguage}, và lượt nói mới sẽ dùng {spokenLanguage}.',
  'Primary language': 'Ngôn ngữ chính',
  'Require an exact cursor-card approval for host-required actions.':
    'Yêu cầu phê duyệt chính xác trên thẻ cạnh con trỏ cho các hành động do hệ thống yêu cầu.',
  'Private on-device summary': 'Tóm tắt riêng tư trên thiết bị',
  'Realtime voice is ready. The microphone stays off until you hold the shortcut.':
    'Giọng nói thời gian thực đã sẵn sàng. Micrô sẽ tắt cho đến khi bạn giữ phím tắt.',
  'Restart to update': 'Khởi động lại để cập nhật',
  'Restarting…': 'Đang khởi động lại…',
  Saved: 'Đã lưu',
  'Run host-approved action types without a per-action prompt for new tasks.':
    'Chạy các loại hành động được hệ thống cho phép mà không hỏi từng lần trong tác vụ mới.',
  'Saved task history': 'Lịch sử tác vụ đã lưu',
  'Save preferences': 'Lưu tùy chọn',
  'Saving…': 'Đang lưu…',
  'Screen Recording': 'Ghi màn hình',
  Scoping: 'Đang xác định phạm vi',
  'Select and copy the code': 'Chọn và sao chép mã',
  'Send your reference code to the TroCode team. When your access is approved, paste the activation code you receive below.':
    'Gửi mã tham chiếu cho đội ngũ TroCode. Khi quyền truy cập được phê duyệt, hãy dán mã kích hoạt bạn nhận được vào bên dưới.',
  'Send answer': 'Gửi câu trả lời',
  'Send steering': 'Gửi chỉ dẫn',
  'Sending…': 'Đang gửi…',
  'Session task record': 'Bản ghi tác vụ phiên này',
  'Session only': 'Chỉ phiên này',
  'Session summary': 'Tóm tắt phiên',
  Settings: 'Cài đặt',
  'Show me how to organize my Downloads folder':
    'Chỉ tôi cách sắp xếp thư mục Tải về',
  'Sign out': 'Đăng xuất',
  'Signing out…': 'Đang đăng xuất…',
  'Something needs attention': 'Có nội dung cần chú ý',
  'Speak now…': 'Hãy nói ngay…',
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
  tasks: 'tác vụ',
  Tasks: 'Tác vụ',
  'TASK COMPLETION RATE': 'TỶ LỆ HOÀN THÀNH TÁC VỤ',
  'TASKS OBSERVED': 'TÁC VỤ ĐÃ GHI NHẬN',
  'Task details': 'Chi tiết tác vụ',
  'Task behavior': 'Hoạt động tác vụ',
  'Task events will appear here.': 'Sự kiện tác vụ sẽ xuất hiện ở đây.',
  'Task in motion': 'Tác vụ đang thực hiện',
  'Task needs attention': 'Tác vụ cần chú ý',
  'Task stopped safely': 'Tác vụ đã dừng an toàn',
  'Task trail': 'Dấu vết tác vụ',
  Target: 'Đích',
  'Text tasks work now. Connect only when you want the agent to use visible applications.':
    'Tác vụ văn bản đã sẵn sàng. Chỉ kết nối khi bạn muốn trợ lý sử dụng các ứng dụng hiển thị trên màn hình.',
  'Text tasks work without microphone or computer permissions. Choose your spoken language now; voice and computer use remain optional and can be connected only when you need them.':
    'Tác vụ văn bản hoạt động mà không cần quyền micrô hoặc máy tính. Hãy chọn ngôn ngữ nói; giọng nói và điều khiển máy tính vẫn là tùy chọn và chỉ cần kết nối khi bạn sử dụng.',
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
  'TroCode chooses from the tools currently available and asks before consequential actions.':
    'TroCode chọn trong số công cụ hiện có và sẽ hỏi trước các hành động có hệ quả.',
  'TroCode could not start automatically. You can try again.':
    'TroCode không thể tự động bắt đầu. Bạn có thể thử lại.',
  'TroCode uses this to keep voice transcription in the language you expect. You can change it later in Settings.':
    'TroCode dùng lựa chọn này để phiên âm giọng nói đúng ngôn ngữ bạn mong đợi. Bạn có thể đổi lại trong Cài đặt.',
  'Task activity': 'Hoạt động tác vụ',
  'TroCode needs your input': 'TroCode cần phản hồi của bạn',
  'TroCode sends this as a transcription hint so short or noisy speech is less likely to be interpreted as an unexpected language or script.':
    'TroCode gửi lựa chọn này làm gợi ý phiên âm để lời nói ngắn hoặc có tạp âm ít bị nhận diện nhầm thành ngôn ngữ hay hệ chữ khác.',
  'TroCode will still enforce target grounding, budgets, blocked destinations, cancellation, and result verification.':
    'TroCode vẫn bắt buộc neo đúng mục tiêu, giới hạn ngân sách, chặn đích không an toàn, cho phép hủy và xác minh kết quả.',
  'TroCode registers itself with macOS for Screen Recording. If System Settings opens, switch on the TroCode row—you should not need the + button. Then return here and we’ll connect automatically. Screen Recording may require restarting TroCode once.':
    'TroCode tự đăng ký với macOS để ghi màn hình. Nếu Cài đặt hệ thống mở ra, hãy bật TroCode trong danh sách—bạn không cần dùng nút +. Sau đó quay lại đây và chúng tôi sẽ tự động kết nối. Quyền ghi màn hình có thể yêu cầu khởi động lại TroCode một lần.',
  'Updates unavailable': 'Không thể cập nhật',
  'Updates as your agent works': 'Cập nhật khi trợ lý làm việc',
  Unavailable: 'Không khả dụng',
  'Understanding request': 'Đang hiểu yêu cầu',
  'Use another Google account': 'Dùng tài khoản Google khác',
  'Use the app in': 'Sử dụng ứng dụng bằng',
  'Version {version}': 'Phiên bản {version}',
  'Voice and language': 'Giọng nói và ngôn ngữ',
  'Voice input': 'Đầu vào giọng nói',
  'Voice ready. Hold {shortcut} to talk.':
    'Giọng nói đã sẵn sàng. Giữ {shortcut} để nói.',
  'Voice ready. Hold {shortcut} to talk from any app.':
    'Giọng nói đã sẵn sàng. Giữ {shortcut} để nói từ bất kỳ ứng dụng nào.',
  'Voice ready. Hold {shortcut} to talk, or hold {globalShortcut} globally.':
    'Giọng nói đã sẵn sàng. Giữ {shortcut} để nói hoặc giữ {globalShortcut} trên toàn hệ thống.',
  'Voice recognition is unavailable. Type your request instead.':
    'Nhận dạng giọng nói không khả dụng. Hãy nhập yêu cầu bằng bàn phím.',
  'Waiting for microphone access…': 'Đang chờ quyền truy cập micrô…',
  Transcribing: 'Đang phiên âm',
  Workspace: 'Không gian làm việc',
  'What language will you usually speak?': 'Bạn thường sẽ nói ngôn ngữ nào?',
  'What should we accomplish?': 'Chúng ta cần hoàn thành điều gì?',
  'What should we do next?': 'Tiếp theo chúng ta nên làm gì?',
  'Why TroCode stopped': 'Lý do TroCode dừng lại',
  You: 'Bạn',
  'Your active task has not settled yet.': 'Tác vụ đang chạy chưa kết thúc.',
  'Your move': 'Đến lượt bạn',
  'Your reference code': 'Mã tham chiếu của bạn',
  'Fix the failing tests in my project': 'Sửa các bài kiểm thử đang lỗi trong dự án của tôi',
  'Follow the live signal, steer the next safe step, or stop the task at any time.':
    'Theo dõi tín hiệu trực tiếp, điều hướng bước an toàn tiếp theo hoặc dừng tác vụ bất cứ lúc nào.',
  'Less': 'Ít hơn',
  'More': 'Nhiều hơn',
  'Last six weeks': 'Sáu tuần qua',
  'Membership access': 'Quyền thành viên',
  'Membership needs attention': 'Tư cách thành viên cần được chú ý',
  Microphone: 'Micrô',
  'Mode': 'Chế độ',
  'No execution steps': 'Không có bước thực thi',
  'Nothing executes until scope and approvals are checked.':
    'Không có gì được thực thi cho đến khi phạm vi và phê duyệt được kiểm tra.',
  Required: 'Bắt buộc',
  Blocked: 'Bị chặn',
  Checking: 'Đang kiểm tra',
  'Try again': 'Thử lại',
  'Type or hold the voice shortcut to answer…':
    'Nhập hoặc giữ phím tắt giọng nói để trả lời…',
  'Waiting for the OpenAI agent provider before starting.':
    'Đang chờ nhà cung cấp trợ lý OpenAI trước khi bắt đầu.',
  'Waiting for OpenAI Realtime and the CUA Driver before starting.':
    'Đang chờ OpenAI Realtime và trình điều khiển CUA trước khi bắt đầu.',
  'Open YouTube for me': 'Mở YouTube giúp tôi',
  'Open YouTube for me, research a topic, fix code, or guide me through an app…':
    'Mở YouTube giúp tôi, nghiên cứu một chủ đề, sửa mã hoặc hướng dẫn tôi dùng một ứng dụng…',
  'Optional permissions are shown here for visibility, but they do not block the workspace. TroCode asks for them only when you choose voice or computer use.':
    'Các quyền tùy chọn được hiển thị để bạn dễ theo dõi nhưng không chặn không gian làm việc. TroCode chỉ yêu cầu khi bạn chọn dùng giọng nói hoặc điều khiển máy tính.',
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
  'Renew your TroCode membership': 'Gia hạn tư cách thành viên TroCode',
  'Request access': 'Yêu cầu quyền truy cập',
  'Research three note-taking apps and compare them':
    'Nghiên cứu và so sánh ba ứng dụng ghi chú',
  'Return to Agent to watch, steer, or stop it. Its final record will appear here.':
    'Quay lại Trợ lý để theo dõi, điều hướng hoặc dừng tác vụ. Bản ghi cuối cùng sẽ xuất hiện ở đây.',
  'Return to live task': 'Quay lại tác vụ đang chạy',
  'Review the request below. TroCode will hold position until you answer or approve the exact action.':
    'Xem lại yêu cầu bên dưới. TroCode sẽ chờ cho đến khi bạn trả lời hoặc phê duyệt chính xác hành động.',
  'Same task': 'Cùng tác vụ',
  'Spoken or typed “yes” cannot approve this action. Use the button below.':
    'Nói hoặc nhập “có” không thể phê duyệt hành động này. Hãy dùng nút bên dưới.',
  verifying: 'đang xác minh',
  'View task trail': 'Xem dấu vết tác vụ',
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
      ? (VIETNAMESE_TRANSLATIONS[message] ?? message)
      : message;

  for (const [key, value] of Object.entries(replacements)) {
    translated = translated.replaceAll(`{${key}}`, String(value));
  }
  return translated;
}
