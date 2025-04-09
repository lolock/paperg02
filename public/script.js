// Wait for the HTML document to be fully loaded before running the script
document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Element References ---
    const loginCodeInput = document.getElementById('login-code');
    const loginButton = document.getElementById('login-btn');
    const loginStatus = document.getElementById('login-status');
    const newChatButton = document.getElementById('new-chat-btn');
    const historyList = document.getElementById('history-list');
    const chatWindow = document.getElementById('chat-window');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');

    // --- Application State ---
    let isLoggedIn = false;
    let currentChatId = null;
    let userLoginCode = null; // Store login code after successful login
    let currentAppState = null; // Store state received from backend { status: '...', current_chapter_index: ... }

    // --- Initial Setup ---
    messageInput.disabled = true;
    sendButton.disabled = true;
    loginStatus.textContent = '';
    chatWindow.innerHTML = '';
    displayInfoMessage("请输入有效的 10 位登录码以开始。");

    // --- Helper Functions ---

    /**
     * Displays a message in the chat window.
     * @param {string} text - The message text.
     * @param {'user' | 'ai' | 'system'} sender - Who sent the message.
     * @param {string} [elementId] - Optional unique ID for the message element.
     */
    function displayMessage(text, sender, elementId = null) {
        const messageElement = document.createElement('div');
        if (elementId) {
            messageElement.id = elementId; // Assign ID if provided
        }
        // Added 'message-bubble' class for potential future styling/selection
        messageElement.classList.add('mb-4', 'p-3', 'rounded-lg', 'max-w-xl', 'w-fit', 'text-sm', 'md:text-base', 'message-bubble');

        let contentContainer = document.createElement('div'); // Container for content

        if (sender === 'user') {
            messageElement.classList.add('bg-indigo-500', 'text-white', 'ml-auto', 'rounded-br-none');
            contentContainer.textContent = text;
        } else if (sender === 'ai') {
            messageElement.classList.add('bg-gray-200', 'text-gray-800', 'mr-auto', 'rounded-bl-none');
            // Basic Markdown support
            text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); // Bold
            text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');       // Italics
            text = text.replace(/`(.*?)`/g, '<code class="bg-gray-300 px-1 rounded text-sm">$1</code>'); // Inline code
             // Handle potential multi-line code blocks (very basic)
             text = text.replace(/```([\s\S]*?)```/g, '<pre class="bg-gray-800 text-white p-2 rounded text-sm overflow-x-auto"><code>$1</code></pre>');
             // Handle newlines properly for HTML display
             text = text.replace(/\n/g, '<br>');
            contentContainer.innerHTML = text; // Use innerHTML for AI messages to render markdown
        } else { // 'system'
             messageElement.classList.add('bg-yellow-100', 'text-yellow-800', 'text-center', 'mx-auto', 'text-xs', 'italic');
             contentContainer.textContent = text;
        }

        messageElement.appendChild(contentContainer);
        chatWindow.appendChild(messageElement);
        // Scroll to the bottom of the chat window to show the latest message
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

     /**
      * Updates an existing message bubble, typically the AI "thinking" indicator.
      * @param {string} elementId - The ID of the message element to update.
      * @param {string} newText - The new text content for the message.
      */
     function updateMessage(elementId, newText) {
        const messageElement = document.getElementById(elementId);
        if (messageElement) {
            // Apply the same basic Markdown rendering as displayMessage for 'ai'
            newText = newText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            newText = newText.replace(/\*(.*?)\*/g, '<em>$1</em>');
            newText = newText.replace(/`(.*?)`/g, '<code class="bg-gray-300 px-1 rounded text-sm">$1</code>');
            newText = newText.replace(/```([\s\S]*?)```/g, '<pre class="bg-gray-800 text-white p-2 rounded text-sm overflow-x-auto"><code>$1</code></pre>');
            newText = newText.replace(/\n/g, '<br>');
            // Update the inner container's HTML
            const contentContainer = messageElement.querySelector('div');
            if(contentContainer) {
                contentContainer.innerHTML = newText;
            }
             // Remove temporary styling like italics if it was applied
             messageElement.classList.remove('italic', 'text-gray-500');
            // Ensure chat scrolls down after update
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }
     }


    /**
     * Displays an informational message in the chat window.
     * @param {string} text - The informational text.
     */
    function displayInfoMessage(text) {
        displayMessage(text, 'system');
    }

    /**
     * Enables or disables the chat input and send button based on login status and input content.
     * @param {boolean} enable - True to enable, false to disable.
     */
    function setChatEnabled(enable) {
        messageInput.disabled = !enable;
        // Send button is disabled if not enabled OR if input is empty
        sendButton.disabled = !enable || messageInput.value.trim() === '';
        // Update placeholder whenever enabling/disabling chat
        updateInputPlaceholder();
    }

    /**
     * Handles the login process by calling the backend API.
     * This is the CORRECT version that uses fetch.
     */
    async function handleLogin() {
        const code = loginCodeInput.value.trim();
        loginStatus.textContent = '正在验证...'; // Provide feedback
        loginStatus.classList.remove('text-red-400', 'text-green-500');
        loginButton.disabled = true; // Disable button during request

        // Basic frontend validation (still useful)
        if (!/^\d{10}$/.test(code)) {
            loginStatus.textContent = '请输入有效的 10 位数字登录码。';
            loginStatus.classList.add('text-red-400');
            loginButton.disabled = false; // Re-enable button
            return; // Stop processing
        }

        try {
            // --- Call the backend /api/login endpoint ---
            console.log(`Sending code ${code} to /api/login`); // Log before fetch
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ code: code }), // Send code in JSON body
            });

            // Log raw response status
            console.log(`/api/login response status: ${response.status}`);
            // Try to parse JSON, handle potential errors if response is not JSON
            let result;
            try {
                result = await response.json();
                console.log(`/api/login response body:`, result);
            } catch (jsonError) {
                console.error("Failed to parse JSON response:", jsonError);
                // Handle cases where backend might not return JSON (e.g., unexpected server errors)
                result = { success: false, error: `服务器响应无效 (状态: ${response.status})` };
            }


            // Check if the request was successful (status code 2xx) AND backend confirms success
            if (response.ok && result.success) {
                // --- Login Successful (Confirmed by Backend) ---
                console.log('Backend login successful:', result.message);
                loginStatus.textContent = '登录成功！';
                loginStatus.classList.add('text-green-500');
                isLoggedIn = true;
                userLoginCode = code; // Store the code for chat requests
                setChatEnabled(true); // Enable chat input/button
                loginCodeInput.disabled = true; // Disable login input
                loginButton.textContent = '已登录'; // Keep login button disabled
                loginButton.classList.remove('bg-green-500', 'hover:bg-green-600');
                loginButton.classList.add('bg-gray-500', 'cursor-not-allowed');
                displayInfoMessage("登录成功，可以开始对话了。");

            } else {
                // --- Login Failed (Rejected by Backend or Network Error) ---
                console.error('Backend login failed:', result.error || `HTTP status ${response.status}`);
                // Display error message from backend response, or a generic one
                loginStatus.textContent = result.error || '登录失败，请检查登录码。';
                loginStatus.classList.add('text-red-400');
                isLoggedIn = false;
                setChatEnabled(false); // Keep chat disabled
                loginButton.disabled = false; // Re-enable button for another try
            }

        } catch (error) {
            // --- Network or other errors during fetch ---
            console.error('Error calling login API:', error);
            loginStatus.textContent = '无法连接到服务器，请稍后重试。';
            loginStatus.classList.add('text-red-400');
            isLoggedIn = false;
            setChatEnabled(false);
            loginButton.disabled = false; // Re-enable button
        }
    }

    /**
     * Handles sending a message by calling the backend chat API.
     */
    async function handleSendMessage() {
        const messageText = messageInput.value.trim();

        // Ensure message is not empty and user is logged in
        if (!messageText || !isLoggedIn || !userLoginCode) {
             if (!isLoggedIn) {
                displayInfoMessage("请先登录后再发送消息。");
             }
             return;
        }

        console.log('Sending message to backend:', messageText);
        displayMessage(messageText, 'user'); // Display user's message immediately

        // Clear input and disable send button while waiting for response
        const originalInput = messageText; // Keep original message for potential retry later
        messageInput.value = '';
        sendButton.disabled = true;
        messageInput.style.height = 'auto'; // Reset textarea height
        messageInput.focus(); // Keep focus on input

        // Display a "thinking" indicator for the AI response
        const thinkingId = `ai-thinking-${Date.now()}`; // Unique ID for the thinking bubble
        displayMessage("...", 'ai', thinkingId); // Display '...' in an AI bubble
        // Add styling to make the thinking indicator visually distinct
        document.getElementById(thinkingId)?.classList.add('italic', 'text-gray-500');


        try {
            // Call the backend /api/chat endpoint
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                // Send message and the validated login code
                body: JSON.stringify({
                    message: originalInput, // Send the original message
                    code: userLoginCode
                }),
            });

            // Try to parse JSON, handle potential errors if response is not JSON
            let result;
             try {
                result = await response.json();
                console.log(`/api/chat response body:`, result);
            } catch (jsonError) {
                console.error("Failed to parse JSON response from /api/chat:", jsonError);
                result = { reply: null, error: `服务器响应无效 (状态: ${response.status})` };
            }


            // Check if the API call was successful and returned a reply
            if (response.ok && result.reply) {
                // --- AI Response Successful ---
                console.log('Backend chat successful.');
                // Update the "thinking" bubble with the actual AI reply
                updateMessage(thinkingId, result.reply); // Render AI reply (includes potential instructions)

                // Store the state received from backend
                currentAppState = result.state || null;
                console.log('Received state:', currentAppState);

                // Update UI based on the new state
                updateInputPlaceholder(); // Update placeholder text

                // Handle completed state
                if (currentAppState && currentAppState.status === 'COMPLETED') {
                   displayInfoMessage("流程已完成。您可以点击“新聊天”开始新的项目。");
                   setChatEnabled(false); // Disable input after completion
                   messageInput.placeholder = "流程已完成";
                }

            } else {
                // --- AI Response Failed (Backend error or invalid response) ---
                console.error('Backend chat failed:', result.error || `HTTP status ${response.status}`);
                const errorMsg = result.error || `与 AI 服务通信时出错 (代码: ${response.status})`;
                 // Update the "thinking" bubble with the error message
                updateMessage(thinkingId, `抱歉，出错了：${errorMsg}`);
                 // Change the bubble style to indicate error
                 const errorBubble = document.getElementById(thinkingId);
                 if(errorBubble) {
                    errorBubble.classList.add('bg-red-100', 'text-red-700');
                    errorBubble.classList.remove('bg-gray-200', 'text-gray-800', 'italic', 'text-gray-500');
                 }
                 // Don't update currentAppState on error
            }

        } catch (error) {
            // --- Network or other errors during fetch ---
            console.error('Error calling chat API:', error);
             // Update the "thinking" bubble with the network error message
            updateMessage(thinkingId, `抱歉，网络错误，无法发送消息。`);
            const errorBubble = document.getElementById(thinkingId);
            if(errorBubble) {
               errorBubble.classList.add('bg-red-100', 'text-red-700');
               errorBubble.classList.remove('bg-gray-200', 'text-gray-800', 'italic', 'text-gray-500');
            }
        } finally {
             // Re-enable input for the next message (unless completed)
             if (isLoggedIn && (!currentAppState || currentAppState.status !== 'COMPLETED')) {
                 messageInput.disabled = false;
                 // Re-evaluate send button state based on potentially empty input
                 sendButton.disabled = messageInput.value.trim() === '';
             } else {
                 // If somehow logged out or completed, keep disabled
                 messageInput.disabled = true;
                 sendButton.disabled = true;
             }
             // Ensure correct placeholder is set even after error/finally
             updateInputPlaceholder();
        }
    }

    /**
     * Updates the message input placeholder based on the current application state.
     */
    function updateInputPlaceholder() {
        if (!isLoggedIn) {
            messageInput.placeholder = "请先登录...";
            return;
        }

        if (!currentAppState || currentAppState.status === 'AWAITING_INITIAL_INPUT') {
            messageInput.placeholder = "请输入您的初始需求...";
        } else if (currentAppState.status === 'AWAITING_OUTLINE_APPROVAL') {
            // {{ 编辑 1: 修改提示，移除 E/A 选项 }}
            messageInput.placeholder = "检查大纲后，输入 'C' 确认，或直接输入修改意见...";
        // {{ 编辑 2: 删除 EDITING_OUTLINE 状态的判断 }}
        // ... 'EDITING_OUTLINE' 对应的 else if 代码块已被移除
        } else if (currentAppState.status === 'AWAITING_CHAPTER_FEEDBACK') {
            const chapterNum = currentAppState.current_chapter_index !== null ? currentAppState.current_chapter_index + 1 : '?';
        // {{ 编辑 3: 修改提示，移除 E/A 选项 }}
            messageInput.placeholder = `检查第 ${chapterNum} 章后，输入 'C' 确认，或直接输入修改意见...`;
        // {{ 编辑 4: 删除 EDITING_CHAPTER 状态的判断 }}
        // ... 'EDITING_CHAPTER' 对应的 else if 代码块已被移除
        // {{ 编辑 5: 删除 AWAITING_NEXT_ACTION 状态的判断 }}
        // ... 'AWAITING_NEXT_ACTION' 对应的 else if 代码块已被移除
        } else if (currentAppState.status === 'GENERATING_OUTLINE' || currentAppState.status === 'GENERATING_CHAPTER') {
             messageInput.placeholder = "AI 正在处理，请稍候...";
        } else if (currentAppState.status === 'COMPLETED') {
            messageInput.placeholder = "流程已完成";
        }
         else {
            messageInput.placeholder = "输入你的消息..."; // Default
        }
    }


    /**
     * Handles starting a new chat session.
     */
    /**
     * Handles the "New Chat" button click.
     * Clears the chat window, resets the application state, AND calls the backend to reset KV state.
     */
    async function handleNewChat() { // {{ 编辑 1: 将函数改为 async }}
        if (!isLoggedIn || !userLoginCode) {
            displayInfoMessage("请先成功登录。");
            return;
        }

        // 禁用按钮防止重复点击
        newChatButton.disabled = true;
        displayInfoMessage("正在重置会话状态..."); // 提供即时反馈

        try {
            // {{ 编辑 2: 调用后端 /api/reset 端点 }}
            const response = await fetch('/api/reset', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ code: userLoginCode }), // 发送当前用户的登录码
            });

            const result = await response.json(); // 尝试解析响应

            if (!response.ok || !result.success) {
                 // 如果后端重置失败，显示错误信息并且不清除前端
                 console.error('Failed to reset backend state:', result);
                 displayInfoMessage(`重置会话失败: ${result.error || '未知错误'}`);
                 // 不进行前端清理，让用户可以重试或继续当前会话
                 return; // 停止执行
            }

            // {{ 编辑 3: 后端重置成功后，才清理前端 }}
            // Clear the chat display window
            chatWindow.innerHTML = '';
            // Clear the message input field
            messageInput.value = '';
            // Reset the internal application state tracker
            currentAppState = null; // Or reset to initial state if needed by UI logic
            // Display a confirmation message
            displayInfoMessage("新的对话已开始。请描述您的需求。");
            // Reset the input placeholder based on the (now reset) state
            updateInputPlaceholder(); // 确保占位符更新
             // Enable chat input
            setChatEnabled(true);


        } catch (error) {
            console.error('Error during new chat creation:', error);
            displayInfoMessage(`创建新对话时出错: ${error.message}`);
        } finally {
            // 无论成功或失败，重新启用按钮
             newChatButton.disabled = false;
        }
    }

    // --- Event Listeners ---
    loginButton.addEventListener('click', handleLogin);
    loginCodeInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            handleLogin();
        }
    });

    sendButton.addEventListener('click', handleSendMessage);
    messageInput.addEventListener('keypress', (event) => {
        // Allow sending with Shift+Enter for newlines, Enter alone to send
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault(); // Prevent default newline behavior
            handleSendMessage();
        }
    });
    // Update send button state when input changes
     messageInput.addEventListener('input', () => {
         // Only enable send if logged in AND input is not empty
         sendButton.disabled = !isLoggedIn || messageInput.value.trim() === '';
     });

    newChatButton.addEventListener('click', handleNewChat); // {{ 编辑 4: 确保事件监听器已绑定 }}

}); // End of DOMContentLoaded