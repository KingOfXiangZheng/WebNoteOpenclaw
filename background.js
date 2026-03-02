// Background Service Worker v1.4.2 — OpenClaw 助手 (SDK 增强版)
// ============================================================
import OpenAI from 'openai';

const DEFAULT_CONFIG = {
    gatewayUrl: 'http://127.0.0.1:18789',
    gatewayToken: '123456',
    model: 'default',
    saveDir: 'workspace/web-notes',
    // 用户提示词模板
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
    // 系统提示词模板 (v1.4.0 新增)
    systemPromptTemplate: `你是一个集成在 OpenClaw 的智能笔记助手。
我会提供网页内容和 URL。请你：
1. 深入分析网页 URL ({pageUrl}) 指向的背景，结合内容进行专业总结。
2. 笔记内容详尽、条理清晰。
3. 【指令】：将结果总结为 Markdown 格式。
4. 注意，总结的笔记重点在与选中内容，而不是网页的其它内容，提供的URL只是帮助理解选中的内容。`,
    // Direct AI 配置 (v1.4.2)
    preferredMode: 'auto', // 'auto', 'openclaw', 'direct'
    directBaseUrl: '',
    directToken: '',
    directModel: '',
    directSaveSubDir: 'web-notes',
    directSaveAs: false,
};

// ---- 增强日志系统 ----
async function addLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const logEntry = { timestamp, message, type };

    console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`);

    try {
        const { logs = [] } = await chrome.storage.local.get(['logs']);
        logs.unshift(logEntry);
        if (logs.length > 100) logs.length = 100;
        await chrome.storage.local.set({ logs });

        chrome.runtime.sendMessage({ action: 'updateLogs', logs }).catch(() => { });
    } catch (e) {
        console.error('日志写入失败:', e);
    }
}

// ---- 文件历史系统 ----
async function addFileToHistory(fileName) {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const fileEntry = { timestamp, name: fileName };

    try {
        const { generatedFiles = [] } = await chrome.storage.local.get(['generatedFiles']);
        generatedFiles.unshift(fileEntry);
        if (generatedFiles.length > 50) generatedFiles.length = 50;
        await chrome.storage.local.set({ generatedFiles });

        chrome.runtime.sendMessage({ action: 'updateFiles', files: generatedFiles }).catch(() => { });
    } catch (e) {
        console.error('文件历史记录失败:', e);
    }
}

// ---- 插件初始化 ----
chrome.runtime.onInstalled.addListener(async (details) => {
    addLog(`插件初始化: ${details.reason}`, 'success');

    // 获取完整配置并合并默认值
    const syncData = await chrome.storage.sync.get(null);
    const mergedConfig = { ...DEFAULT_CONFIG, ...syncData };

    // 如果关键配置不存在，说明是初次安装或旧版本升级
    if (!syncData.gatewayUrl || !syncData.systemPromptTemplate) {
        await chrome.storage.sync.set(mergedConfig);
        addLog('已初始化/同步默认配置参数', 'info');
    }

    chrome.contextMenus.removeAll(() => {
        updateContextMenus(mergedConfig.preferredMode);
        addLog('右键菜单已初始化', 'info');
    });
});

// ---- 动态菜单更新 ----
async function updateContextMenus(mode) {
    const titles = {
        auto: 'OpenClaw (自动)',
        openclaw: 'OpenClaw',
        direct: 'Direct AI'
    };
    const suffix = titles[mode] || 'OpenClaw';

    chrome.contextMenus.update('send-selection-to-openclaw', {
        title: `📝 发送选中内容到 ${suffix}`
    }).catch(() => {
        chrome.contextMenus.create({
            id: 'send-selection-to-openclaw',
            title: `📝 发送选中内容到 ${suffix}`,
            contexts: ['selection']
        });
    });

    chrome.contextMenus.update('send-image-to-openclaw', {
        title: `📝 发送图片到 ${suffix}`
    }).catch(() => {
        chrome.contextMenus.create({
            id: 'send-image-to-openclaw',
            title: `📝 发送图片到 ${suffix}`,
            contexts: ['image']
        });
    });
}

// 监听配置变化
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.preferredMode) {
        updateContextMenus(changes.preferredMode.newValue);
        addLog(`菜单模式提取更新: ${changes.preferredMode.newValue}`, 'info');
    }
});

// ---- 菜单点击处理中心 ----
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) {
        addLog('点击失败: 无法获取标签页 ID', 'error');
        return;
    }

    try {
        if (info.menuItemId === 'send-selection-to-openclaw') {
            await handleSelectionSend(tab);
        } else if (info.menuItemId === 'send-image-to-openclaw') {
            await handleImageSend(info, tab);
        }
    } catch (err) {
        addLog(`流程中断: ${err.message}`, 'error');
        sendToast(tab.id, `流程中断: ${err.message}`, 'error');
    }
});

/**
 * 处理选中文本发送
 */
async function handleSelectionSend(tab) {
    addLog(`准备抓取网页内容... TabID: ${tab.id}`);
    sendToast(tab.id, '正在抓取网页内容...', 'sending', 0, 10);

    let response;
    try {
        response = await chrome.tabs.sendMessage(tab.id, { action: 'getSelection' });
    } catch (e) {
        addLog(`通信失败: 请刷新页面后再试。${e.message}`, 'error');
        sendToast(tab.id, '发送失败：请刷新网页后再试', 'error');
        return;
    }

    if (!response || (!response.text && (!response.images || response.images.length === 0))) {
        addLog('抓取内容为空', 'warning');
        sendToast(tab.id, '未检测到选中的内容', 'error');
        return;
    }

    addLog(`捕获成功: ${response.text?.length || 0}字, ${response.images?.length || 0}图`);

    let content = response.text || '';
    if (response.images?.length > 0) {
        content += '\n\n' + response.images.map((url, i) => `![图${i + 1}](${url})`).join('\n');
    }

    await processAndSave(content, response.pageTitle, response.pageUrl, tab.id);
}

/**
 * 处理单张图片发送
 */
async function handleImageSend(info, tab) {
    addLog(`正在处理选中图片...`);
    sendToast(tab.id, '正在处理图片...', 'sending', 0, 15);
    const content = `![图片](${info.srcUrl})`;
    await processAndSave(content, tab.title || '图片页', tab.url || '', tab.id);
}

/**
 * 调用 OpenClaw 核心流程
 */
async function processAndSave(content, pageTitle, pageUrl, tabId) {
    addLog('正在准备 AI 请求参数...');
    sendToast(tabId, '正在准备笔记数据...', 'sending', 0, 30);

    const config = await chrome.storage.sync.get([
        'gatewayUrl', 'gatewayToken', 'model', 'saveDir', 'promptTemplate', 'systemPromptTemplate',
        'preferredMode', 'directBaseUrl', 'directToken', 'directModel', 'directSaveSubDir', 'directSaveAs'
    ]);
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    const userPrompt = mergedConfig.promptTemplate
        .replace('{content}', content)
        .replace('{pageTitle}', pageTitle)
        .replace('{pageUrl}', pageUrl);

    const safeTitle = (pageTitle || 'note').replace(/[\\/:"*?<>|]+/g, '_').substring(0, 25);
    const dateStr = new Date().toLocaleDateString('zh-CN').replace(/\//g, '-');
    const filename = `${dateStr}_${safeTitle}.md`;

    // 决定使用哪种模式
    let useDirect = false;
    let modeLabel = 'OpenClaw';

    if (mergedConfig.preferredMode === 'direct') {
        useDirect = true;
        modeLabel = 'Direct AI';
    } else if (mergedConfig.preferredMode === 'auto' || mergedConfig.preferredMode === 'openclaw') {
        // 尝试测试 OpenClaw 连接 (快请求)
        try {
            const check = await fetch(`${mergedConfig.gatewayUrl.replace(/\/$/, '')}/v1/models`, {
                headers: { 'Authorization': `Bearer ${mergedConfig.gatewayToken}` },
                signal: AbortSignal.timeout(2000) // 2秒超时
            });
            if (!check.ok) throw new Error('status not ok');
        } catch (e) {
            if (mergedConfig.preferredMode === 'openclaw') {
                throw new Error('OpenClaw 连接失败，且未开启直连备选。');
            }
            useDirect = true;
            modeLabel = 'Direct AI (回退)';
            addLog('OpenClaw 连接失败，切换到 Direct AI 模式', 'warning');
        }
    }

    // 准备系统提示词
    let systemPrompt = mergedConfig.systemPromptTemplate
        .replace(/{pageUrl}/g, pageUrl);

    if (!useDirect) {
        // OpenClaw 特有指令
        systemPrompt += `\n【指令】：使用你的文件工具将结果保存为 Markdown 文件。\n【保存路径】：${mergedConfig.saveDir || 'workspace'}\n【文件名】：${filename}`;
    }

    addLog(`正在请求 ${modeLabel}...`, 'info');
    sendToast(tabId, `🤖 ${modeLabel} 正在处理...`, 'sending', 0, 50);

    const startTime = Date.now();
    try {
        let reply;
        if (useDirect) {
            if (!mergedConfig.directBaseUrl || !mergedConfig.directToken) {
                throw new Error('Direct AI 未配置 Base URL 或 Token');
            }
            reply = await callChatAPI(mergedConfig.directBaseUrl, mergedConfig.directToken, mergedConfig.directModel || 'gpt-3.5-turbo', systemPrompt, userPrompt);

            // 手动保存文件 (Downloads API)
            await saveViaDownloads(filename, reply, mergedConfig.directSaveSubDir, mergedConfig.directSaveAs);
            addLog(`文件已通过浏览器下载器保存: ${filename}`, 'success');
        } else {
            reply = await callChatAPI(mergedConfig.gatewayUrl, mergedConfig.gatewayToken, mergedConfig.model, systemPrompt, userPrompt);
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        addLog(`${modeLabel} 处理成功 (耗时 ${duration}s)`, 'success');
        addLog(`AI 回复预览: ${reply.substring(0, 40)}...`);

        sendToast(tabId, '同步状态中...', 'sending', 0, 95);

        // 记录到历史文件列表
        await addFileToHistory(filename);

        const successMsg = useDirect ? '✨ 笔记已通过下载器保存！' : '✨ 笔记已存入 OpenClaw！';

        setTimeout(() => {
            sendToast(tabId, successMsg, 'success', 5000, 100);
            chrome.notifications?.create({
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: '✅ 笔记已保存',
                message: `[${modeLabel}] 耗时 ${duration}s，文件名: ${filename}`
            });
        }, 300);

    } catch (err) {
        addLog(`API 呼叫失败: ${err.message}`, 'error');
        sendToast(tabId, `处理失败: ${err.message}`, 'error');
    }
}

/**
 * 封装 OpenAI 兼容 API 呼叫 (使用 SDK)
 */
async function callChatAPI(baseUrl, token, model, sys, user) {
    let apiBase = baseUrl.replace(/\/$/, '');

    // 智能处理 API Base
    if (!apiBase.endsWith('/v1')) {
        // 如果用户直接输入了 /v1/chat/completions 等，只提取到 /v1
        const v1Index = apiBase.indexOf('/v1');
        if (v1Index !== -1) {
            apiBase = apiBase.substring(0, v1Index + 3);
        } else {
            // 某些国内模型可能不需要 /v1，但官方 SDK 默认会加。这里如果是第三方链接且没写 v1，我们帮他加一个，除非他明确写了其它版本。
            // 为了最大的兼容性，如果用户没写 /v1 且地址不包含 chat/completions，我们自动尝试加上 /v1
            if (!apiBase.includes('/v2') && !apiBase.includes('/v3')) {
                apiBase += '/v1';
            }
        }
    }

    const openai = new OpenAI({
        baseURL: apiBase,
        apiKey: token,
        dangerouslyAllowBrowser: true // 在扩展环境中是安全的
    });

    try {
        const completion = await openai.chat.completions.create({
            model: model || 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: sys },
                { role: 'user', content: user }
            ],
            temperature: 0.3,
        });

        const content = completion.choices?.[0]?.message?.content;

        if (content) {
            return content;
        } else {
            console.error('SDK 返回异常结构:', completion);
            return `未返回有效正文 (结果: ${completion.choices?.[0]?.finish_reason || 'unknown'})`;
        }
    } catch (err) {
        console.error('SDK 调用失败:', err);
        throw new Error(`[SDK Error] ${err.message}`);
    }
}

/**
 * 浏览器下载保存
 */
async function saveViaDownloads(filename, content, subDir = 'web-notes', saveAs = false) {
    const blob = new Blob([content], { type: 'text/markdown' });
    const reader = new FileReader();

    // 清理子目录路径
    const cleanSubDir = subDir.replace(/[\\:*?<>|]+/g, '_').replace(/^\/+|\/+$/g, '');
    const fullPath = cleanSubDir ? `${cleanSubDir}/${filename}` : filename;

    return new Promise((resolve, reject) => {
        reader.onload = () => {
            chrome.downloads.download({
                url: reader.result,
                filename: fullPath,
                conflictAction: 'uniquify',
                saveAs: saveAs
            }, (downloadId) => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else resolve(downloadId);
            });
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * 通用 Toast 通知
 */
function sendToast(tabId, message, type = 'success', duration = 3000, progress = 0) {
    chrome.tabs.sendMessage(tabId, { action: 'showToast', message, type, duration, progress }).catch(() => {
        if (type !== 'sending') {
            chrome.notifications?.create({
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: 'OpenClaw 通知',
                message: message
            });
        }
    });
}
