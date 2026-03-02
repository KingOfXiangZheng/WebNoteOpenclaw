// Popup Script — v1.4.2 (SDK 增强版)
// ============================================================
import OpenAI from 'openai';

const DEFAULT_CONFIG = {
    gatewayUrl: 'http://127.0.0.1:18789',
    gatewayToken: '123456',
    model: 'default',
    saveDir: 'workspace/web-notes',
    promptTemplate: `请将以下从网页中选取的内容总结成结构清晰、要点明确的笔记。

要求：
1. 用 Markdown 格式输出，提取关键知识点。
2. 结合给出的网页 URL 及其背景进行总结。
3. 如果有图片，以 ![图片](url) 格式保留。
4. 结尾附上来源标题和固定链接。

来源页面：{pageTitle}
来源链接：{pageUrl}

选中内容：
{content}
`,
    systemPromptTemplate: `你是一个集成在 OpenClaw 的智能笔记助手。
我会提供网页内容和 URL。请你：
1. 深入分析网页 URL ({pageUrl}) 指向的背景，结合内容进行专业总结。
2. 笔记内容详尽、条理清晰。
3. 【指令】：将结果总结为 Markdown 格式。
4. 注意，总结的笔记重点在与选中内容，而不是网页的其它内容，提供的URL只是帮助理解选中的内容。`,
    // Direct AI 配置 (v1.4.2)
    preferredMode: 'auto',
    directBaseUrl: '',
    directToken: '',
    directModel: '',
    directSaveSubDir: 'web-notes',
    directSaveAs: false,
};

// DOM 元素
const elements = {
    gatewayUrl: document.getElementById('gatewayUrl'),
    gatewayToken: document.getElementById('gatewayToken'),
    model: document.getElementById('model'),
    saveDir: document.getElementById('saveDir'),
    systemPromptTemplate: document.getElementById('systemPromptTemplate'),
    promptTemplate: document.getElementById('promptTemplate'),
    preferredMode: document.getElementById('preferredMode'),
    directBaseUrl: document.getElementById('directBaseUrl'),
    directToken: document.getElementById('directToken'),
    directModel: document.getElementById('directModel'),
    directSaveSubDir: document.getElementById('directSaveSubDir'),
    directSaveAs: document.getElementById('directSaveAs'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    logContainer: document.getElementById('logContainer'),
    fileContainer: document.getElementById('fileContainer'),
    toggleToken: document.getElementById('toggleToken'),
    toggleDirectToken: document.getElementById('toggleDirectToken'),
    message: document.getElementById('message'),
    toast: document.getElementById('toast'),
    // 按钮行
    settingsActions: document.getElementById('settingsActions'),
    logsActions: document.getElementById('logsActions'),
    filesActions: document.getElementById('filesActions')
};

// ---- 初始化 ----
document.addEventListener('DOMContentLoaded', () => {
    // 1. 加载设置
    chrome.storage.sync.get(Object.keys(DEFAULT_CONFIG), (result) => {
        Object.keys(DEFAULT_CONFIG).forEach(key => {
            if (elements[key]) {
                if (elements[key].type === 'checkbox') {
                    elements[key].checked = result[key] !== undefined ? result[key] : DEFAULT_CONFIG[key];
                } else {
                    elements[key].value = result[key] || DEFAULT_CONFIG[key];
                }
            }
        });
    });

    // 2. 加载数据
    loadLogs();
    loadFiles();

    // 3. 自动测试
    setTimeout(() => testConnection(true), 300);

    // 4. Tab 切换
    document.querySelectorAll('.tab-link').forEach(button => {
        button.addEventListener('click', () => {
            const target = button.getAttribute('data-tab');

            // 样式更新
            document.querySelectorAll('.tab-link').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            button.classList.add('active');
            document.getElementById(target).classList.add('active');

            // 按钮显隐切换
            elements.settingsActions.style.display = (target === 'settings' || target === 'prompts') ? 'flex' : 'none';
            elements.logsActions.style.display = (target === 'logs') ? 'flex' : 'none';
            elements.filesActions.style.display = (target === 'files') ? 'flex' : 'none';

            // 刷新
            if (target === 'logs') loadLogs();
            if (target === 'files') loadFiles();
        });
    });

    // 5. 事件
    document.getElementById('saveBtn').addEventListener('click', saveAll);
    document.getElementById('testBtn').addEventListener('click', () => testConnection('openclaw', false));
    document.getElementById('testDirectBtn')?.addEventListener('click', () => testConnection('direct', false));
    document.getElementById('clearLogs').addEventListener('click', clearLogs);
    document.getElementById('clearFiles').addEventListener('click', clearFiles);
    document.getElementById('resetBtn').addEventListener('click', resetDefaults);
    elements.toggleToken.addEventListener('click', () => togglePassword('gatewayToken', 'toggleToken'));
    elements.toggleDirectToken.addEventListener('click', () => togglePassword('directToken', 'toggleDirectToken'));
});

// ---- 核心逻辑 ----

function saveAll() {
    const config = {};
    Object.keys(DEFAULT_CONFIG).forEach(key => {
        if (elements[key]) {
            config[key] = elements[key].type === 'checkbox' ? elements[key].checked : elements[key].value;
        }
    });

    chrome.storage.sync.set(config, () => {
        showToast('✅ 设置已保存');
        testConnection('openclaw', true);
    });
}

async function testConnection(target = 'openclaw', silent = false) {
    let url, token, btnId;

    if (target === 'openclaw') {
        url = elements.gatewayUrl.value.trim().replace(/\/$/, '');
        token = elements.gatewayToken.value.trim();
        btnId = 'testBtn';
    } else {
        url = elements.directBaseUrl.value.trim().replace(/\/$/, '');
        token = elements.directToken.value.trim();
        btnId = 'testDirectBtn';
    }

    const btn = document.getElementById(btnId);

    if (!silent && btn) {
        btn.textContent = '测试中...';
        btn.disabled = true;
    }

    try {
        // 智能处理 API Base (逻辑与 background.js 保持一致)
        let apiBase = url;
        if (!apiBase.endsWith('/v1')) {
            const v1Index = apiBase.indexOf('/v1');
            if (v1Index !== -1) {
                apiBase = apiBase.substring(0, v1Index + 3);
            } else if (!apiBase.includes('/v2') && !apiBase.includes('/v3')) {
                apiBase += '/v1';
            }
        }

        const openai = new OpenAI({
            baseURL: apiBase,
            apiKey: token,
            dangerouslyAllowBrowser: true
        });

        // 调用 models.list 来测试连接
        const response = await openai.models.list();

        if (response) {
            if (target === 'openclaw') updateStatus('connected', '在线');
            if (!silent) showToast(`✅ ${target === 'openclaw' ? 'OpenClaw' : 'Direct AI'} 连接成功`);
        } else {
            throw new Error('No response from API');
        }
    } catch (e) {
        console.error('Test Connection Error:', e);
        if (target === 'openclaw') updateStatus('error', '断开');
        if (!silent) showToast(`❌ 连接失败: ${e.message}`);
    } finally {
        if (!silent && btn) {
            btn.textContent = target === 'openclaw' ? '测试连接' : '测试直连';
            btn.disabled = false;
        }
    }
}

// ---- 数据加载 ----

async function loadLogs() {
    const { logs = [] } = await chrome.storage.local.get(['logs']);
    if (!elements.logContainer) return;
    elements.logContainer.innerHTML = logs.length ? '' : '<div class="field-hint" style="text-align:center;margin-top:20px;">暂无日志</div>';
    logs.forEach(log => {
        const div = document.createElement('div');
        div.className = `log-entry log-${log.type || 'info'}`;
        div.innerHTML = `<span class="log-ts">[${log.timestamp}]</span><span class="log-msg">${log.message}</span>`;
        elements.logContainer.appendChild(div);
    });
}

async function loadFiles() {
    const { generatedFiles = [] } = await chrome.storage.local.get(['generatedFiles']);
    if (!elements.fileContainer) return;
    elements.fileContainer.innerHTML = generatedFiles.length ? '' : '<div class="field-hint" style="text-align:center;margin-top:20px;">暂无记录</div>';
    generatedFiles.forEach(file => {
        const div = document.createElement('div');
        div.className = 'file-entry';
        div.innerHTML = `<span class="file-ts">[${file.timestamp}]</span><span class="file-name">${file.name}</span>`;
        elements.fileContainer.appendChild(div);
    });
}

// ---- 工具函数 ----

function clearLogs() {
    chrome.storage.local.set({ logs: [] }, loadLogs);
    showToast('日志已清空');
}

function clearFiles() {
    chrome.storage.local.set({ generatedFiles: [] }, loadFiles);
    showToast('记录已清空');
}

function resetDefaults(e) {
    e.preventDefault();
    Object.keys(DEFAULT_CONFIG).forEach(key => {
        if (elements[key]) elements[key].value = DEFAULT_CONFIG[key];
    });
    showToast('已重置默认，请保存');
}

function togglePassword(inputId, buttonId) {
    const input = document.getElementById(inputId);
    const button = document.getElementById(buttonId);
    const type = input.type === 'password' ? 'text' : 'password';
    input.type = type;
    button.textContent = type === 'password' ? '👁' : '🙈';
}

function updateStatus(state, text) {
    elements.statusDot.className = 'status-dot ' + state;
    elements.statusText.textContent = text;
}

function showToast(msg) {
    elements.toast.textContent = msg;
    elements.toast.classList.add('show');
    setTimeout(() => elements.toast.classList.remove('show'), 2500);
}

// 实时消息监听
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'updateLogs') loadLogs();
    if (msg.action === 'updateFiles') loadFiles();
});
