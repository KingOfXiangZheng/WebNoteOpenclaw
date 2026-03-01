// ============================================================
// Content Script — 捕获页面中用户选中的文本、HTML 和图片
// ============================================================

/**
 * 获取当前选中内容的结构化数据
 * @returns {{ text: string, html: string, images: string[], pageUrl: string, pageTitle: string }}
 */
function getSelectionData() {
  const selection = window.getSelection();
  const data = {
    text: '',
    html: '',
    images: [],
    pageUrl: window.location.href,
    pageTitle: document.title
  };

  if (!selection || selection.rangeCount === 0) {
    return data;
  }

  // 获取纯文本
  data.text = selection.toString().trim();

  // 获取选中区域的 HTML
  const range = selection.getRangeAt(0);
  const container = document.createElement('div');
  container.appendChild(range.cloneContents());
  data.html = container.innerHTML;

  // 提取选中区域内的所有图片
  const imgs = container.querySelectorAll('img');
  imgs.forEach(img => {
    if (img.src) {
      data.images.push(img.src);
    }
  });

  return data;
}

// 监听来自 background.js 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSelection') {
    const data = getSelectionData();
    sendResponse(data);
  } else if (request.action === 'getClickedImage') {
    // 获取右键点击的图片信息（通过 background 传入的 srcUrl）
    sendResponse({
      images: [request.srcUrl],
      text: '',
      html: `<img src="${request.srcUrl}" />`,
      pageUrl: window.location.href,
      pageTitle: document.title
    });
  }
  return true; // keep the message channel open for async response
});

// 注入浮动通知样式
const style = document.createElement('style');
style.textContent = `
  .openclaw-toast {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 2147483647;
    padding: 14px 24px;
    border-radius: 12px;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #fff;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    transform: translateX(120%);
    opacity: 0;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .openclaw-toast-content {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .openclaw-toast.show {
    transform: translateX(0);
    opacity: 1;
  }
  .openclaw-toast.success {
    background: linear-gradient(135deg, rgba(0, 212, 255, 0.9), rgba(0, 150, 200, 0.9));
    border: 1px solid rgba(0, 212, 255, 0.3);
  }
  .openclaw-toast.error {
    background: linear-gradient(135deg, rgba(255, 71, 87, 0.9), rgba(200, 50, 60, 0.9));
    border: 1px solid rgba(255, 71, 87, 0.3);
  }
  .openclaw-toast.sending {
    background: linear-gradient(135deg, rgba(108, 92, 231, 1), rgba(80, 70, 180, 1));
    border: 1px solid rgba(108, 92, 231, 0.3);
  }
  .openclaw-toast .icon {
    font-size: 18px;
    flex-shrink: 0;
  }
  .openclaw-progress-bg {
    width: 100%;
    height: 4px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
    overflow: hidden;
    display: none;
  }
  .openclaw-toast.sending .openclaw-progress-bg {
    display: block;
  }
  .openclaw-progress-bar {
    height: 100%;
    background: #fff;
    width: 0%;
    transition: width 0.3s ease;
  }
`;
document.head.appendChild(style);

/**
 * 在页面上显示浮动通知
 * @param {string} message
 * @param {'success'|'error'|'sending'} type
 * @param {number} duration - 毫秒
 * @param {number} progress - 0 to 100
 */
function showToast(message, type = 'success', duration = 3000, progress = 0) {
  // 查找是否已有正在发送的 toast，如果有且当前也是 sending，则更新它而不是重新创建
  let toast = document.querySelector('.openclaw-toast.sending');

  if (type === 'sending' && toast) {
    toast.querySelector('.openclaw-toast-text').textContent = message;
    const bar = toast.querySelector('.openclaw-progress-bar');
    if (bar) bar.style.width = `${progress}%`;
    return toast;
  }

  // 否则移除所有已有的
  document.querySelectorAll('.openclaw-toast').forEach(el => el.remove());

  const icons = {
    success: '✅',
    error: '❌',
    sending: '⏳'
  };

  toast = document.createElement('div');
  toast.className = `openclaw-toast ${type}`;
  toast.innerHTML = `
    <div class="openclaw-toast-content">
      <span class="icon">${icons[type]}</span>
      <span class="openclaw-toast-text">${message}</span>
    </div>
    <div class="openclaw-progress-bg">
      <div class="openclaw-progress-bar" style="width: ${progress}%"></div>
    </div>
  `;
  document.body.appendChild(toast);

  // 触发动画
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });
  });

  if (duration > 0) {
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, duration);
  }

  return toast;
}

// 监听通知消息 & 剪贴板操作
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'showToast') {
    showToast(request.message, request.type, request.duration, request.progress || 0);
    sendResponse({ ok: true });
  } else if (request.action === 'copyToClipboard') {
    navigator.clipboard.writeText(request.text).then(() => {
      sendResponse({ ok: true });
    }).catch(err => {
      // 后备方案：使用 textarea
      const textarea = document.createElement('textarea');
      textarea.value = request.text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      sendResponse({ ok: true });
    });
    return true; // async
  }
  return true;
});
