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
        if(enable) {
             messageInput.placeholder = "输入你的消息...";
        } else {
             messageInput.placeholder = "请先登录...";
        }
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
                updateMessage(thinkingId, result.reply);
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
             // Re-enable input for the next message
             // Check login status again, just in case
             if (isLoggedIn) {
                 messageInput.disabled = false;
                 // Re-evaluate send button state based on potentially empty input
                 sendButton.disabled = messageInput.value.trim() === '';
             } else {
                 // If somehow logged out during the process, keep disabled
                 messageInput.disabled = true;
                 sendButton.disabled = true;
             }
        }
    }

    /**
     * Handles starting a new chat session.
     */
    function handleNewChat() {
        console.log('Starting new chat...');
        chatWindow.innerHTML = ''; // Clear chat display
        messageInput.value = ''; // Clear input field
        sendButton.disabled = true; // Disable send button
        messageInput.style.height = 'auto'; // Reset input height
        currentChatId = null; // Reset chat identifier (for history later)
        // Display appropriate initial message
        if (isLoggedIn) {
            displayInfoMessage("新的对话已开始。");
        } else {
            displayInfoMessage("请输入有效的 10 位登录码以开始。");
        }
        // TODO: Update history list UI and potentially inform backend later.
    }

    // --- Event Listeners ---
    // Login button click
    loginButton.addEventListener('click', handleLogin);

    // Login input enter key press
     loginCodeInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            handleLogin(); // Trigger login on Enter key
        }
    });

    // Login input validation (allow only 10 digits)
    loginCodeInput.addEventListener('input', () => {
        let value = loginCodeInput.value.replace(/\D/g, ''); // Remove non-digits
        if (value.length > 10) {
            value = value.slice(0, 10); // Limit to 10 digits
        }
        loginCodeInput.value = value;
        // Basic validation feedback while typing
        if (value.length === 10) {
             loginStatus.textContent = ''; // Clear error if length is correct
        } else if (value.length > 0) {
             loginStatus.textContent = '需要 10 位数字。';
             loginStatus.classList.remove('text-green-500');
             loginStatus.classList.add('text-red-400');
        } else {
             loginStatus.textContent = ''; // Clear if empty
        }
    });

    // Message input typing event (enable/disable send button, auto-resize)
    messageInput.addEventListener('input', () => {
        // Enable/disable send button based on input content AND login status
        sendButton.disabled = messageInput.value.trim() === '' || !isLoggedIn;

        // Auto-resize textarea height based on content
        messageInput.style.height = 'auto'; // Reset height to recalculate
        messageInput.style.height = `${messageInput.scrollHeight}px`; // Set to content height
    });

    // Send button click
    sendButton.addEventListener('click', handleSendMessage);

    // Message input Enter key press (send message, unless Shift is held)
    messageInput.addEventListener('keypress', (event) => {
        // Send if Enter is pressed WITHOUT the Shift key
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault(); // Prevent default Enter behavior (new line)
            // Trigger send only if button is not disabled
            if (!sendButton.disabled) {
                 handleSendMessage();
            }
        }
    });

    // New chat button click
    newChatButton.addEventListener('click', handleNewChat);

}); // End of DOMContentLoaded