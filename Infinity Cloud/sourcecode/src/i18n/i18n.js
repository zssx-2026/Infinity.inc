/*
 * i18n.js - the three languages the interface speaks.
 *
 * Every string the user can see goes through t(). The dictionaries are flat
 * so a missing key is obvious rather than silent: t() falls back to English
 * and then to the key itself, which makes an untranslated label show up as
 * something readable in the interface instead of as blank space.
 */

export const LANGS = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'zh-CN', label: 'Simplified Chinese', native: '简体中文' },
  { code: 'zh-TW', label: 'Traditional Chinese', native: '繁體中文' }
];

const DICT = {

  en: {
    choose_language: 'Please choose language:',
    unknown_language: 'Unknown language. Do you mean',
    send_log: 'Do you want to send log to us? (y/n)',
    setup_done: 'The simple setup has ended. For more settings, please enter \"settings list\" to obtain and set them.',
    press_any: 'Press any key to start the cloud...',
    bye: 'Goodbye.',
    ok: 'OK',
    cancel: 'Cancel',
    yes: 'Yes',
    no: 'No',
    on: 'On',
    off: 'Off',
    language: 'Language',
    send_log_opt: 'Send use log to us',
    main_menu: 'Main menu',
    sign_in: 'Sign in / Register',
    mine: 'Mine',
    settings: 'Settings',
    messages: 'Messages',
    sign_in_title: 'Sign in',
    register_title: 'Register',
    forgot_title: 'Recover token',
    username: 'Username',
    token: 'GitHub token',
    auto_login: 'Sign in automatically',
    forgot_token: 'Forgot your token?',
    no_account: 'No account? Register',
    have_account: 'Already have an account? Sign in',
    forgot_hint: 'Open the page in your browser, create a new token, and paste it here.',
    verifying: 'Checking the token...',
    sign_in_ok: 'Signed in as',
    sign_in_fail: 'Could not sign in',
    search_placeholder: 'Search the cloud',
    col_name: 'Name',
    col_size: 'Size',
    col_uploaded: 'Uploaded',
    col_modified: 'Modified',
    col_hash: 'Hash',
    col_cdn: 'CDN',
    copied: 'Copied',
    help_title: 'Commands',
    pull_list: 'Pull list',
    not_signed_in: 'Not signed in',
    hint_more: 'for the command list.',
    task_created: 'Task created. Settings:',
    task_paused: 'Paused',
    task_started: 'Started',
    task_removed: 'Removed',
    cloud_path: 'Cloud path',
    local_path: 'Save to',
    timeout: 'Timeout',
    speed_limit: 'Speed limit',
    version: 'Version',
    hash: 'Hash',
    hash_check: 'Hash check',
    task_id: 'Task id',
    priority: 'Priority',
    pulling_manifest: 'pulling manifest...',
    pull_done: 'pull done.',
    no_repo: 'No storage repo yet. One will be created on first upload.',
    uploaded: 'Uploaded',
    downloaded: 'Downloaded',
    failed: 'Failed',
    progress: 'Progress',
    speed: 'Speed',
    remaining: 'Remaining',
    type: 'Type',
    file: 'file',
    folder: 'folder',
    created: 'Created',
    modified: 'Modified',
    settings_hint: 'Use \"settings list\" to see everything that can be set.',
  },

  'zh-CN': {
    choose_language: '请选择语言：',
    unknown_language: '未知的语言。您是指',
    send_log: '是否向我们发送使用日志？(y/n)',
    setup_done: '简单设置已结束。如需更多设置，请输入 \"settings list\" 获取并设置。',
    press_any: '按任意键启动云盘...',
    bye: '再见。',
    ok: '确定',
    cancel: '取消',
    yes: '是',
    no: '否',
    on: '开',
    off: '关',
    language: '语言',
    send_log_opt: '向我们发送使用日志',
    main_menu: '主菜单',
    sign_in: '登录/注册',
    mine: '我的',
    settings: '设置',
    messages: '消息',
    sign_in_title: '登录',
    register_title: '注册',
    forgot_title: '找回 token',
    username: '用户名',
    token: 'github token',
    auto_login: '自动登录',
    forgot_token: '忘记 token ？',
    no_account: '没有账户？注册',
    have_account: '已有账户？登录',
    forgot_hint: '请在浏览器打开后执行创建新 token 操作并返回填写新 token。',
    verifying: '验证 token 有效性...',
    sign_in_ok: '已登录：',
    sign_in_fail: '登录失败',
    search_placeholder: '搜索云盘文件',
    col_name: '文件名',
    col_size: '大小',
    col_uploaded: '上传时间',
    col_modified: '修改时间',
    col_hash: '哈希',
    col_cdn: 'CDN',
    copied: '已复制',
    help_title: '命令列表',
    pull_list: '拉取清单',
    not_signed_in: '未登录',
    hint_more: '查看命令列表。',
    task_created: '已创建任务。设置：',
    task_paused: '已暂停',
    task_started: '已开始',
    task_removed: '已删除',
    cloud_path: '云路径',
    local_path: '下载到',
    timeout: '超时时间',
    speed_limit: '速度限制',
    version: '拉取版本',
    hash: '哈希',
    hash_check: '哈希校验',
    task_id: '任务 ID',
    priority: '优先级',
    pulling_manifest: 'pulling manifest...',
    pull_done: 'pull done.',
    no_repo: '还没有存储仓库，首次上传时会自动创建。',
    uploaded: '已上传',
    downloaded: '已下载',
    failed: '失败',
    progress: '进度',
    speed: '速度',
    remaining: '剩余',
    type: '类型',
    file: '文件',
    folder: '文件夹',
    created: '创建时间',
    modified: '修改时间',
    settings_hint: '输入 \"settings list\" 查看所有可设置的项。',
  },

  'zh-TW': {
    choose_language: '請選擇語言：',
    unknown_language: '未知的語言。您是指',
    send_log: '是否向我們傳送使用日誌？(y/n)',
    setup_done: '簡單設定已結束。如需更多設定，請輸入 \"settings list\" 取得並設定。',
    press_any: '按任意鍵啟動雲端硬碟...',
    bye: '再見。',
    ok: '確定',
    cancel: '取消',
    yes: '是',
    no: '否',
    on: '開',
    off: '關',
    language: '語言',
    send_log_opt: '向我們傳送使用日誌',
    main_menu: '主選單',
    sign_in: '登入/註冊',
    mine: '我的',
    settings: '設定',
    messages: '訊息',
    sign_in_title: '登入',
    register_title: '註冊',
    forgot_title: '找回 token',
    username: '使用者名稱',
    token: 'github token',
    auto_login: '自動登入',
    forgot_token: '忘記 token ？',
    no_account: '沒有帳戶？註冊',
    have_account: '已有帳戶？登入',
    forgot_hint: '請在瀏覽器開啟後執行建立新 token 操作並返回填寫新 token。',
    verifying: '驗證 token 有效性...',
    sign_in_ok: '已登入：',
    sign_in_fail: '登入失敗',
    search_placeholder: '搜尋雲端檔案',
    col_name: '檔案名稱',
    col_size: '大小',
    col_uploaded: '上傳時間',
    col_modified: '修改時間',
    col_hash: '雜湊',
    col_cdn: 'CDN',
    copied: '已複製',
    help_title: '指令列表',
    pull_list: '拉取清單',
    not_signed_in: '未登入',
    hint_more: '查看指令列表。',
    task_created: '已建立任務。設定：',
    task_paused: '已暫停',
    task_started: '已開始',
    task_removed: '已刪除',
    cloud_path: '雲端路徑',
    local_path: '下載到',
    timeout: '逾時時間',
    speed_limit: '速度限制',
    version: '拉取版本',
    hash: '雜湊',
    hash_check: '雜湊校驗',
    task_id: '任務 ID',
    priority: '優先級',
    pulling_manifest: 'pulling manifest...',
    pull_done: 'pull done.',
    no_repo: '還沒有儲存庫，首次上傳時會自動建立。',
    uploaded: '已上傳',
    downloaded: '已下載',
    failed: '失敗',
    progress: '進度',
    speed: '速度',
    remaining: '剩餘',
    type: '類型',
    file: '檔案',
    folder: '資料夾',
    created: '建立時間',
    modified: '修改時間',
    settings_hint: '輸入 \"settings list\" 檢視所有可設定的項目。',
  }
};

let current = 'en';

export function setLang(code) {
  if (DICT[code]) current = code;
  return current;
}

export function getLang() { return current; }

/*
 * Fall back English, then the key. A missing translation should never leave
 * a blank label on screen - seeing the key tells you exactly what to add.
 */
export function t(key, ...args) {
  const table = DICT[current] || DICT.en;
  let s = table[key];
  if (s === undefined) s = DICT.en[key];
  if (s === undefined) s = key;
  for (let i = 0; i < args.length; i++) {
    s = s.replace('{' + i + '}', String(args[i]));
  }
  return s;
}

/*
 * Match whatever the user typed against the language table. Returns the code
 * or null. Both the English label and the native name are accepted, and the
 * match ignores case and surrounding space.
 */
export function matchLang(input) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  for (const l of LANGS) {
    if (l.code.toLowerCase() === s) return l.code;
    if (l.label.toLowerCase() === s) return l.code;
    if (l.native.toLowerCase() === s) return l.code;
    if (l.label.toLowerCase().startsWith(s) && s.length >= 2) return l.code;
    if (l.native.startsWith(s) && s.length >= 1) return l.code;
  }
  if (s === 'zh' || s === 'chinese' || s === '中文' || s === 'cn') return 'zh-CN';
  if (s === 'tw' || s === '繁體' || s === '繁体') return 'zh-TW';
  if (s === 'en' || s === 'english') return 'en';
  return null;
}

/*
 * The two closest languages to an unrecognised input, for the "did you mean"
 * prompt. A plain prefix score is enough here and needs no dependency.
 */
export function suggestLangs(input, max = 2) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return [];
  const scored = LANGS.map(function (l) {
    const cands = [l.label.toLowerCase(), l.native.toLowerCase(), l.code.toLowerCase()];
    let best = 0;
    for (const c of cands) {
      let n = 0;
      const len = Math.min(c.length, s.length);
      while (n < len && c[n] === s[n]) n++;
      if (n > best) best = n;
      if (c.indexOf(s) >= 0) best = Math.max(best, s.length + 1);
    }
    return { code: l.code, score: best };
  });
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.filter(function (x) { return x.score > 0; }).slice(0, max).map(function (x) { return x.code; });
}
