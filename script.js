// Wait for the HTML document to be fully loaded before running the script
document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Element References ---
    // Get references to the HTML elements we need to interact with
    const loginCodeInput = document.getElementById('login-code');
    const loginButton = document.getElementById('login-btn');
    const loginStatus = document.getElementById('login-status');
    const newChatButton = document.getElementById('new-chat-btn');
    const historyList = document.getElementById('history-list'); // Will be used later
    const chatWindow = document.getElementById('chat-window');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');

    // --- Application State ---
    // Basic state variables
    let isLoggedIn = false; // Tracks if the user is "logged in" with a code
    let currentChatId = null; // Will store the ID of the current conversation later

    // --- Initial Setup ---
    // Disable chat input and send button initially until logged in
    messageInput.disabled = true;
    sendButton.disabled = true;
    // Clear any previous login status message
    loginStatus.textContent = '';
    // Clear the initial "Start chatting!" message
    chatWindow.innerHTML = '';
    displayInfoMessage("请输入有效的 10 位登录码以开始。"); // Show initial instruction

    // --- Helper Functions ---

    /**
     * Displays a message in the chat window.
     * @param {string} text - The message text.
     * @param {'user' | 'ai' | 'system'} sender - Who sent the message ('user', 'ai', or 'system' for info).
     */
    function displayMessage(text, sender) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('mb-4', 'p-3', 'rounded-lg', 'max-w-xl', 'w-fit', 'text-sm', 'md:text-base'); // Common styles

        if (sender === 'user') {
            messageElement.classList.add('bg-indigo-500', 'text-white', 'ml-auto', 'rounded-br-none'); // User message style
            messageElement.textContent = text;
        } else if (sender === 'ai') {
            messageElement.classList.add('bg-gray-200', 'text-gray-800', 'mr-auto', 'rounded-bl-none'); // AI message style
            // Basic Markdown support (bold, italics, code) - can be expanded
            text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); // Bold
            text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');       // Italics
            text = text.replace(/`(.*?)`/g, '<code class="bg-gray-300 px-1 rounded text-sm">$1</code>'); // Inline code
            messageElement.innerHTML = text; // Use innerHTML for AI messages to render basic markdown
        } else { // 'system' or info messages
             messageElement.classList.add('bg-yellow-100', 'text-yellow-800', 'text-center', 'mx-auto', 'text-xs', 'italic');
             messageElement.textContent = text;
        }

        chatWindow.appendChild(messageElement);
        // Scroll to the bottom of the chat window
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

     /**
     * Displays an informational message in the chat window (e.g., login prompt).
     * @param {string} text - The informational text.
     */
    function displayInfoMessage(text) {
        displayMessage(text, 'system');
    }

    /**
     * Enables or disables the chat input and send button.
     * @param {boolean} enable - True to enable, false to disable.
     */
    function setChatEnabled(enable) {
        messageInput.disabled = !enable;
        sendButton.disabled = !enable || messageInput.value.trim() === ''; // Also check if input is empty
        if(enable) {
             messageInput.placeholder = "输入你的消息...";
             // Maybe remove the info message if chat is enabled after login
             // const infoMsg = chatWindow.querySelector('.bg-yellow-100');
             // if (infoMsg) infoMsg.remove();
        } else {
             messageInput.placeholder = "请先登录...";
        }
    }

    /**
     * Simulates the login process.
     * In a real app, this would involve sending the code to the backend for validation.
     */
    function handleLogin() {
        const code = loginCodeInput.value.trim();
        loginStatus.textContent = ''; // Clear previous status

        // Basic validation (must be 10 digits)
        if (/^\d{10}$/.test(code)) {
            // Simulate successful login (replace with actual API call later)
            console.log('Attempting login with code:', code);
            loginStatus.textContent = '登录成功！';
            loginStatus.classList.remove('text-red-400');
            loginStatus.classList.add('text-green-500');
            isLoggedIn = true;
            setChatEnabled(true); // Enable chat
            loginCodeInput.disabled = true; // Disable input after login
            loginButton.disabled = true; // Disable button after login
            loginButton.textContent = '已登录';
            loginButton.classList.remove('bg-green-500', 'hover:bg-green-600');
            loginButton.classList.add('bg-gray-500', 'cursor-not-allowed');
            displayInfoMessage("登录成功，可以开始对话了。");

            // TODO: Later, send the code to the backend for validation
            // and potentially store a session token/status locally.

        } else {
            console.error('Invalid login code format.');
            loginStatus.textContent = '请输入有效的 10 位数字登录码。';
            loginStatus.classList.remove('text-green-500');
            loginStatus.classList.add('text-red-400');
            isLoggedIn = false;
            setChatEnabled(false); // Keep chat disabled
        }
    }

    /**
     * Handles sending a message.
     */
    function handleSendMessage() {
        const messageText = messageInput.value.trim();

        if (messageText && isLoggedIn) {
            console.log('Sending message:', messageText);
            displayMessage(messageText, 'user'); // Display user's message

            // Clear the input field and disable send button
            messageInput.value = '';
            sendButton.disabled = true;
            messageInput.style.height = 'auto'; // Reset height after sending

            // --- TODO: Backend Integration ---
            // Here you would send the messageText (and potentially chat history)
            // to your Cloudflare Worker backend API endpoint.
            // Example placeholder for AI response:
            setTimeout(() => {
                 displayMessage("我是 AI 的模拟回复...", 'ai');
            }, 1000); // Simulate network delay

        } else if (!isLoggedIn) {
             displayInfoMessage("请先登录后再发送消息。");
        }
    }

    /**
     * Handles starting a new chat.
     */
    function handleNewChat() {
        console.log('Starting new chat...');
        // Clear the chat window
        chatWindow.innerHTML = '';
        // Reset message input
        messageInput.value = '';
        sendButton.disabled = true;
        messageInput.style.height = 'auto';
        currentChatId = null; // Reset current chat ID
        // Display initial message if logged in
        if (isLoggedIn) {
            displayInfoMessage("新的对话已开始。");
        } else {
            displayInfoMessage("请输入有效的 10 位登录码以开始。");
        }
        // TODO: Later, update history list UI and potentially inform the backend.
    }


    // --- Event Listeners ---

    // Login button click
    loginButton.addEventListener('click', handleLogin);

    // Login input enter key press
     loginCodeInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            handleLogin();
        }
    });

    // Login input validation (allow only 10 digits)
    loginCodeInput.addEventListener('input', () => {
        let value = loginCodeInput.value.replace(/\D/g, ''); // Remove non-digits
        if (value.length > 10) {
            value = value.slice(0, 10); // Limit to 10 digits
        }
        loginCodeInput.value = value;
        // Basic validation feedback while typing (optional)
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


    // Message input typing event
    messageInput.addEventListener('input', () => {
        // Enable/disable send button based on input content and login status
        sendButton.disabled = messageInput.value.trim() === '' || !isLoggedIn;

        // Auto-resize textarea height
        messageInput.style.height = 'auto'; // Reset height
        messageInput.style.height = `${messageInput.scrollHeight}px`; // Set to scroll height
    });

    // Send button click
    sendButton.addEventListener('click', handleSendMessage);

    // Message input Enter key press (send message)
    messageInput.addEventListener('keypress', (event) => {
        // Send if Enter is pressed WITHOUT the Shift key
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault(); // Prevent default Enter behavior (new line)
            if (!sendButton.disabled) { // Check if button is enabled
                 handleSendMessage();
            }
        }
    });

    // New chat button click
    newChatButton.addEventListener('click', handleNewChat);

}); // End of DOMContentLoaded

