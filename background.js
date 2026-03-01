// ============================================================
// Background Service Worker v1.4.0 — OpenClaw 助手 (UI/UX & 提示词增强版)
// ============================================================

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
3. 【指令】：使用你的文件工具将结果保存为 Markdown 文件。
4. 【保存路径】：{saveDir}
5. 【文件名】：{filename}
6. 注意，总结的笔记重点在与选中内容，而不是网页的其它内容，提供的URL只是帮助理解选中的内容。`
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

    const config = await chrome.storage.sync.get(['gatewayUrl', 'systemPromptTemplate']);

    // 如果系统提示词不存在，说明是旧版本升级，需要合并新默认值
    if (!config.gatewayUrl || !config.systemPromptTemplate) {
        const currentConfig = await chrome.storage.sync.get(null);
        await chrome.storage.sync.set({ ...DEFAULT_CONFIG, ...currentConfig });
        addLog('已同步 v1.4.0 配置参数（含系统提示词）', 'info');
    }

    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: 'send-selection-to-openclaw',
            title: '📝 发送选中内容到 OpenClaw',
            contexts: ['selection']
        });
        chrome.contextMenus.create({
            id: 'send-image-to-openclaw',
            title: '📝 发送图片到 OpenClaw',
            contexts: ['image']
        });
        addLog('右键菜单已注册', 'info');
    });
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
        'gatewayUrl', 'gatewayToken', 'model', 'saveDir', 'promptTemplate', 'systemPromptTemplate'
    ]);
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    const userPrompt = mergedConfig.promptTemplate
        .replace('{content}', content)
        .replace('{pageTitle}', pageTitle)
        .replace('{pageUrl}', pageUrl);

    const safeTitle = (pageTitle || 'note').replace(/[\\/:"*?<>|]+/g, '_').substring(0, 25);
    const dateStr = new Date().toLocaleDateString('zh-CN').replace(/\//g, '-');
    const filename = `${dateStr}_${safeTitle}.md`;

    addLog(`即将保存至: ${mergedConfig.saveDir}/${filename}`);

    // 使用可配置的系统提示词，并替换变量
    const systemPrompt = mergedConfig.systemPromptTemplate
        .replace(/{pageUrl}/g, pageUrl)
        .replace(/{saveDir}/g, mergedConfig.saveDir || 'workspace')
        .replace(/{filename}/g, filename);

    addLog('正在请求 OpenClaw Agent...', 'info');
    sendToast(tabId, '🤖 Agent 正在总结并保存...', 'sending', 0, 50);

    const startTime = Date.now();
    try {
        const reply = await callOpenClaw(mergedConfig.gatewayUrl, mergedConfig.gatewayToken, mergedConfig.model, systemPrompt, userPrompt);
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        addLog(`OpenClaw 处理成功 (耗时 ${duration}s)`, 'success');
        addLog(`AI 回复预览: ${reply.substring(0, 40)}...`);

        sendToast(tabId, '同步状态中...', 'sending', 0, 95);

        // 记录到历史文件列表
        await addFileToHistory(filename);

        setTimeout(() => {
            sendToast(tabId, '✨ 笔记已存入 OpenClaw！', 'success', 5000, 100);
            chrome.notifications?.create({
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: '✅ 笔记已保存',
                message: `耗时 ${duration}s，文件名: ${filename}`
            });
        }, 300);

    } catch (err) {
        addLog(`API 呼叫失败: ${err.message}`, 'error');
        sendToast(tabId, `处理失败: ${err.message}`, 'error');
    }
}

/**
 * 封装 API 呼叫
 */
async function callOpenClaw(baseUrl, token, model, sys, user) {
    const apiPath = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

    const res = await fetch(apiPath, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
            temperature: 0.3
        })
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`[HTTP ${res.status}] ${errText.substring(0, 100)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '未返回有效正文';
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
