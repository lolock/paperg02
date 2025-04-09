/**
 * Cloudflare Worker entry point for handling API requests.
 * Intercepts requests made to /api/*
 *
 * Environment variables expected:
 * - OPENAI_API_KEY: Your OpenAI-compatible API key (Secret).
 * - API_ENDPOINT: The BASE URL for the LLM API endpoint (e.g., "https://api.openai.com/v1").
 * - SYSTEM_PROMPT: The system prompt for the LLM.
 * - LLM_MODEL: The model name to use (e.g., "gpt-4", "gpt-3.5-turbo").
 * - KV_NAMESPACE: Binding to the Cloudflare KV namespace (for auth codes & usage).
 */

// {{ Define corsHeaders at the top level }}
const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // Consider restricting in production
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', // Added GET for potential future use
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};


export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    // Only respond to requests starting with /api/
    if (!url.pathname.startsWith('/api/')) {
        return new Response('Not Found', { status: 404 });
    }

    // Handle CORS preflight requests first
    if (request.method === 'OPTIONS') {
        // Use the specific handleOptions function which includes Max-Age
        return handleOptions();
    }

    let response; // Variable to hold the eventual response object

    try {
        // --- Request Routing ---
        if (url.pathname === '/api/login' && request.method === 'POST') {
            response = await handleLoginRequest(request, env);
        } else if (url.pathname === '/api/chat' && request.method === 'POST') {
            response = await handleChatRequest(request, env);
        // {{ Add routing for reset }}
        } else if (url.pathname === '/api/reset' && request.method === 'POST') {
             response = await handleResetRequest(request, env);
        } else {
            // Route not found or method not allowed
            console.warn(`No matching route found for ${request.method} ${url.pathname}.`);
            // Return JSON error with CORS headers
            response = new Response(JSON.stringify({ error: 'API route not found' }), {
                status: 404,
                // Use global corsHeaders here too
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Ensure we always have a Response object after the handler call
        if (!(response instanceof Response)) {
            console.error("Handler did not return a valid Response object. Assigning 500.");
            // Return JSON error with CORS headers
            response = new Response(JSON.stringify({ error: 'Internal Server Error: Invalid handler response' }), {
                status: 500,
                // Use global corsHeaders here too
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

    } catch (error) {
        // Catch unexpected errors during request routing or handler execution itself
        console.error('Error during request handling or handler execution:', error);
        // Return JSON error with CORS headers
        response = new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
            status: 500,
            // Use global corsHeaders here too
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    // --- Add/Merge CORS Headers to the final response ---
    // Create new Headers object from the handler's response headers
    const finalHeaders = new Headers(response.headers);
    // Merge global CORS headers, potentially overwriting if already set by handler
    Object.entries(corsHeaders).forEach(([key, value]) => {
        finalHeaders.set(key, value);
    });

    // Return the final response with the merged headers
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: finalHeaders // Use the merged headers
    });
}

/**
 * Handles CORS preflight requests (OPTIONS).
 */
function handleOptions() {
    // Specific headers for OPTIONS request, including Max-Age
    return new Response(null, {
        status: 204, // No Content
        headers: {
            ...corsHeaders, // Include the base CORS headers
            'Access-Control-Max-Age': '86400', // Cache preflight for 1 day
        },
    });
}

/**
 * Handles the /api/login POST request using KV validation.
 * @param {Request} request
 * @param {object} env - Contains KV_NAMESPACE binding
 * @returns {Promise<Response>}
 */
async function handleLoginRequest(request, env) {
    console.log(`Handling login request from: ${request.headers.get('CF-Connecting-IP')}`);
    let loginCode;
    // Define standard Content-Type header for JSON responses
    const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

    try {
        const { code } = await request.json();
        loginCode = code; // Extract code from JSON body

        // Basic validation (redundant with frontend, but good practice)
        if (!/^\d{10}$/.test(loginCode)) {
            console.warn(`Invalid code format received in login request: ${loginCode}`);
            // Use jsonHeaders
            return new Response(JSON.stringify({ success: false, error: '无效的登录码格式' }), {
                status: 400,
                headers: jsonHeaders,
            });
        }
        console.log(`Received valid format login code: ${loginCode}`); // Log valid format receipt

    } catch (error) {
        console.error('Error parsing login request body:', error);
        // Use jsonHeaders
        return new Response(JSON.stringify({ success: false, error: '无效的请求体' }), {
            status: 400,
            headers: jsonHeaders,
        });
    }

    try {
        console.log(`Checking code ${loginCode} in KV...`); // Log before KV read
        const storedStateString = await env.KV_NAMESPACE.get(loginCode);
        let initialState; // Define initialState here

        if (!storedStateString) {
            // --- Code not found in KV - New User or First Time ---
            console.log(`Code ${loginCode} not found. Creating initial state.`); // Log new user
            // {{ 编辑 1: 创建包含 conversation_history 的初始状态 }}
            initialState = {
                status: 'AWAITING_INITIAL_INPUT',
                current_chapter_index: null,
                estimated_chapters: null,
                approved_outline: null,
                confirmed_chapters: [],
                conversation_history: [], // 确保包含空的对话历史
                last_chapter_content: null
            };
            // --- Save the newly created initial state back to KV ---
            await env.KV_NAMESPACE.put(loginCode, JSON.stringify(initialState));
            console.log(`Initial state for ${loginCode} saved to KV.`); // Log state save
            // Use jsonHeaders
            return new Response(JSON.stringify({ success: true, message: '登录成功，状态已初始化' }), {
                status: 200,
                headers: jsonHeaders,
            });
        } else {
            // --- Code found, try to parse existing state ---
            console.log(`Code ${loginCode} found in KV. Parsing state...`); // Log found code
            try {
                const currentState = JSON.parse(storedStateString);
                // {{ 编辑 2: 增加对 conversation_history 的健全性检查 }}
                // 检查核心字段是否存在且 conversation_history 是数组
                if (currentState && typeof currentState.status === 'string' && Array.isArray(currentState.conversation_history)) {
                    console.log(`State for ${loginCode} parsed successfully and seems valid.`); // Log valid state
                    // State is valid and has conversation_history
                    return new Response(JSON.stringify({ success: true, message: '登录成功，状态已加载' }), {
                        status: 200,
                        headers: jsonHeaders,
                    });
                } else {
                     // State is corrupted or old format (missing conversation_history or status)
                     console.warn(`State for ${loginCode} is invalid/corrupted. Resetting to initial state.`); // Log reset due to corruption
                     // Treat as new user: create and save initial state
                     initialState = { // Use the same initialState definition from above
                          status: 'AWAITING_INITIAL_INPUT',
                          current_chapter_index: null,
                          estimated_chapters: null,
                          approved_outline: null,
                          confirmed_chapters: [],
                          conversation_history: [], // 确保包含空的对话历史
                          last_chapter_content: null
                     };
                     await env.KV_NAMESPACE.put(loginCode, JSON.stringify(initialState));
                     console.log(`Invalid state for ${loginCode} overwritten with initial state in KV.`); // Log overwrite
                     return new Response(JSON.stringify({ success: true, message: '登录成功，状态已重置' }), {
                          status: 200,
                          headers: jsonHeaders,
                     });
                }
            } catch (parseError) {
                // Error parsing JSON from KV - state is likely corrupted
                console.error(`Error parsing stored state for ${loginCode}:`, parseError); // Log parsing error
                // Treat as new user: create and save initial state
                initialState = { // Use the same initialState definition from above
                   status: 'AWAITING_INITIAL_INPUT',
                   current_chapter_index: null,
                   estimated_chapters: null,
                   approved_outline: null,
                   confirmed_chapters: [],
                   conversation_history: [], // 确保包含空的对话历史
                   last_chapter_content: null
                };
                await env.KV_NAMESPACE.put(loginCode, JSON.stringify(initialState));
                console.log(`Corrupted state for ${loginCode} overwritten with initial state in KV.`); // Log overwrite
                return new Response(JSON.stringify({ success: true, message: '登录成功，状态已重置' }), {
                    status: 200,
                    headers: jsonHeaders,
                });
            }
        }
    } catch (kvError) {
        console.error(`KV operation failed for code ${loginCode}:`, kvError);
        // Use jsonHeaders
        return new Response(JSON.stringify({ success: false, error: '无法访问状态存储' }), {
            status: 500,
            headers: jsonHeaders,
        });
    }
}

/**
 * Handles the /api/chat POST request using KV validation, state management, and calling LLM API.
 * @param {Request} request
 * @param {object} env - Environment object
 * @returns {Promise<Response>}
 */
/**
 * Handles the /api/chat request.
 * Processes user messages based on the current state stored in KV.
 * Manages the conversation history and interacts with the LLM.
 */
async function handleChatRequest(request, env) {
    console.log(`Handling chat request from: ${request.headers.get('CF-Connecting-IP')}`);
    let requestPayload;
    try {
        requestPayload = await request.json();
        if (!requestPayload.code || !requestPayload.message) {
            throw new Error("Missing 'code' or 'message' in request body");
        }
        console.log(`Chat request received for code ${requestPayload.code}`);
    } catch (error) {
        console.error('Error parsing chat request body:', error);
        return new Response(JSON.stringify({ error: '无效的请求体' }), { status: 400, headers: jsonHeaders });
    }

    const { message: userMessage, code: loginCode } = requestPayload;

    try {
        // --- 1. Load Current State & History ---
        console.log(`Loading state for ${loginCode} from KV...`);
        const storedStateString = await env.KV_NAMESPACE.get(loginCode);

        if (!storedStateString) {
            console.error(`No state found in KV for code ${loginCode}. User might not be logged in properly.`);
            return new Response(JSON.stringify({ error: '未找到会话状态，请尝试重新登录' }), { status: 404, headers: jsonHeaders });
        }

        let currentState;
        try {
            currentState = JSON.parse(storedStateString);
            // Ensure conversation_history exists and is an array (redundant check, belt-and-suspenders)
            if (!Array.isArray(currentState.conversation_history)) {
                 console.warn(`conversation_history missing or not an array for ${loginCode}. Initializing.`);
                 currentState.conversation_history = [];
            }
            console.log(`State for ${loginCode} loaded. Current status: ${currentState.status}`);
        } catch (parseError) {
            console.error(`Error parsing stored state for ${loginCode} during chat:`, parseError);
            return new Response(JSON.stringify({ error: '无法解析会话状态' }), { status: 500, headers: jsonHeaders });
        }

        // --- 2. Append User Message to History ---
        currentState.conversation_history.push({ role: 'user', content: userMessage });
        console.log(`Appended user message to history. History length: ${currentState.conversation_history.length}`);


        let aiReply = null; // Initialize AI reply variable

        // --- 3. Determine Action based on State & Potentially Call LLM ---

        const systemPrompt = { role: 'system', content: `${env.SYSTEM_PROMPT}\n当前状态: ${currentState.status}` };
        const llmMessages = [ systemPrompt, ...currentState.conversation_history ]; // Default to full history

        // --- State Machine Logic ---
        if (currentState.status === 'AWAITING_INITIAL_INPUT') {
            // First user message after login/reset
            currentState.status = 'GENERATING_OUTLINE';
            // Optional: Add a specific instruction for outline generation
            // llmMessages.push({ role: "user", content: "根据以上需求，生成论文大纲。" });
            console.log(`Status -> GENERATING_OUTLINE`);
        } else if (currentState.status === 'AWAITING_OUTLINE_APPROVAL') {
            if (userMessage.trim().toUpperCase() === 'C') {
                // User confirmed outline
                currentState.status = 'GENERATING_CHAPTER';
                currentState.current_chapter_index = 0; // Start with the first chapter
                // Optional: Add instruction for generating the first chapter
                // llmMessages.push({ role: "user", content: "大纲已确认。现在请根据大纲生成第 1 章内容。" });
                console.log(`Outline approved. Status -> GENERATING_CHAPTER, Index -> 0`);
            } else {
                // User provided feedback/modification for outline
                currentState.status = 'GENERATING_OUTLINE'; // Go back to generate outline again
                // Optional: Add instruction to revise outline based on feedback
                // llmMessages.push({ role: "user", content: "请根据以上反馈修改大纲。" });
                console.log(`Outline feedback received. Status -> GENERATING_OUTLINE`);
            }
        } else if (currentState.status === 'AWAITING_CHAPTER_FEEDBACK') {
             const chapterNum = currentState.current_chapter_index + 1;
            if (userMessage.trim().toUpperCase() === 'C') {
                // User confirmed current chapter
                currentState.confirmed_chapters.push({
                    index: currentState.current_chapter_index,
                    content: currentState.last_chapter_content || "内容未记录" // Store the *last* AI reply as chapter content
                });
                currentState.current_chapter_index++;
                console.log(`Chapter ${chapterNum} approved. Saved. Index -> ${currentState.current_chapter_index}`);

                // Estimate total chapters based on outline (if available)
                if (currentState.approved_outline && !currentState.estimated_chapters) {
                     const outlineLines = currentState.approved_outline.split('\n').filter(line => line.trim().length > 0);
                     currentState.estimated_chapters = Math.max(Math.floor(outlineLines.length / 2), 1); // Basic estimation, ensure at least 1
                     console.log(`Estimated chapters based on outline: ${currentState.estimated_chapters}`);
                }

                // Check if completed
                if (currentState.estimated_chapters && currentState.current_chapter_index >= currentState.estimated_chapters) {
                    currentState.status = 'COMPLETED';
                    console.log(`All estimated chapters completed. Status -> COMPLETED`);
                    // Don't call LLM, maybe send a completion message?
                    aiReply = "所有章节已根据大纲完成。流程结束。";
                } else {
                    currentState.status = 'GENERATING_CHAPTER'; // Proceed to next chapter
                    // Optional: Add instruction for the next chapter
                    // llmMessages.push({ role: "user", content: `第 ${chapterNum} 章已确认。现在请生成第 ${currentState.current_chapter_index + 1} 章内容。`});
                    console.log(`Status -> GENERATING_CHAPTER for index ${currentState.current_chapter_index}`);
                }
            } else {
                // User provided feedback/modification for chapter
                currentState.status = 'GENERATING_CHAPTER'; // Regenerate the *same* chapter
                // Optional: Add instruction to revise chapter based on feedback
                // llmMessages.push({ role: "user", content: `请根据以上反馈修改第 ${chapterNum} 章内容。` });
                console.log(`Chapter ${chapterNum} feedback received. Regenerating. Status -> GENERATING_CHAPTER`);
            }
        }
        // Handle GENERATING states - they require an LLM call
        if (currentState.status === 'GENERATING_OUTLINE' || currentState.status === 'GENERATING_CHAPTER') {
            console.log(`Calling LLM API. Endpoint: ${env.API_ENDPOINT}, Model: ${env.LLM_MODEL}`);
            try {
                 const llmResponse = await fetch(`${env.API_ENDPOINT}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${env.OPENAI_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: env.LLM_MODEL,
                        messages: llmMessages, // <<< Pass the full history + system prompt
                        stream: false // Assuming non-streaming for now
                    }),
                });

                if (!llmResponse.ok) {
                    const errorBody = await llmResponse.text();
                    console.error(`LLM API request failed with status ${llmResponse.status}: ${errorBody}`);
                    throw new Error(`LLM API 错误 (${llmResponse.status})`);
                }

                const llmData = await llmResponse.json();
                if (!llmData.choices || llmData.choices.length === 0 || !llmData.choices[0].message || !llmData.choices[0].message.content) {
                    console.error("Invalid LLM response structure:", llmData);
                    throw new Error("无效的 LLM 响应");
                }

                aiReply = llmData.choices[0].message.content.trim();
                console.log("LLM processing successful.");

                // --- Update State based on LLM response ---
                if (currentState.status === 'GENERATING_OUTLINE') {
                    currentState.approved_outline = aiReply; // Store the generated outline
                    currentState.status = 'AWAITING_OUTLINE_APPROVAL'; // Move to approval state
                    console.log(`Outline generated. Status -> AWAITING_OUTLINE_APPROVAL`);
                } else if (currentState.status === 'GENERATING_CHAPTER') {
                     currentState.last_chapter_content = aiReply; // Store the generated chapter content temporarily
                    currentState.status = 'AWAITING_CHAPTER_FEEDBACK'; // Move to feedback state
                    console.log(`Chapter ${currentState.current_chapter_index + 1} generated. Status -> AWAITING_CHAPTER_FEEDBACK`);
                }

            } catch (llmError) {
                console.error('Error during LLM API call:', llmError);
                // Keep state as GENERATING but return error message
                aiReply = `抱歉，在调用 AI 服务时出错: ${llmError.message}`;
                // Don't change status, allow retry maybe? Or revert status? For now, return error message.
            }
        }

        // --- 4. Append AI Reply to History (if applicable) ---
        // Only append if we actually got a reply (either from LLM or a canned response like "COMPLETED")
        if (aiReply !== null) {
           currentState.conversation_history.push({ role: 'assistant', content: aiReply });
           console.log(`Appended assistant message to history. History length: ${currentState.conversation_history.length}`);
        } else if (currentState.status !== 'COMPLETED' && currentState.status !== 'AWAITING_INITIAL_INPUT') {
            // Handle cases where no AI reply was generated but maybe should have?
            console.warn(`Reached end of chat handler for status ${currentState.status} without generating an AI reply.`);
            aiReply = "内部状态错误，未生成回复。"; // Default error message
            currentState.conversation_history.push({ role: 'assistant', content: aiReply });
        }


        // --- 5. Save Updated State & History Back to KV ---
        console.log(`Saving updated state for ${loginCode} to KV. Status: ${currentState.status}`);
        await env.KV_NAMESPACE.put(loginCode, JSON.stringify(currentState));
        console.log(`State for ${loginCode} successfully saved.`);

        // --- 6. Return Response to Frontend ---
        return new Response(JSON.stringify({
            reply: aiReply, // The AI's response message
            state: { // Send back the relevant parts of the state for UI updates
                status: currentState.status,
                current_chapter_index: currentState.current_chapter_index
                // Add other fields if the frontend needs them (e.g., estimated_chapters)
            }
        }), {
            status: 200,
            headers: corsHeaders
        });

    } catch (error) {
        console.error(`Unhandled error in handleChatRequest for code ${loginCode}:`, error);
        return new Response(JSON.stringify({ error: `服务器内部错误: ${error.message}` }), {
            status: 500, // Internal Server Error
            headers: corsHeaders // 使用文件顶部定义的 corsHeaders
        });
    }
}

/**
 * Handles the /api/reset request.
 * Resets the state for the given code in KV_NAMESPACE back to initial values.
 */
async function handleResetRequest(request, env) {
    console.log(`Handling reset request from: ${request.headers.get('CF-Connecting-IP')}`);
    let requestPayload;
    try {
        requestPayload = await request.json();
        if (!requestPayload.code || !/^\d{10}$/.test(requestPayload.code)) {
            throw new Error("Missing or invalid 'code' in request body");
        }
        console.log(`Reset request received for code ${requestPayload.code}`);
    } catch (error) {
        console.error('Error parsing reset request body:', error);
        // 使用文件顶部定义的 corsHeaders
        return new Response(JSON.stringify({ success: false, error: '无效的请求体或登录码' }), { status: 400, headers: corsHeaders });
    }

    const { code: loginCode } = requestPayload;

    try {
        // --- Define the Initial State ---
        // Ensure this matches the initial state defined in handleLoginRequest
        const initialState = {
            status: 'AWAITING_INITIAL_INPUT',
            current_chapter_index: null,
            estimated_chapters: null,
            approved_outline: null,
            confirmed_chapters: [],
            conversation_history: [], // <<<< Crucial: Reset history to empty array
            last_chapter_content: null
        };

        // --- Overwrite the state in KV with the initial state ---
        console.log(`Resetting state for ${loginCode} in KV...`);
        await env.KV_NAMESPACE.put(loginCode, JSON.stringify(initialState));
        console.log(`State for ${loginCode} successfully reset in KV.`);

        // --- Return Success Response ---
        // 使用文件顶部定义的 corsHeaders
        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: corsHeaders
        });

    } catch (kvError) {
        console.error(`KV operation failed during reset for code ${loginCode}:`, kvError); // Log KV error
        // 使用文件顶部定义的 corsHeaders
        return new Response(JSON.stringify({ success: false, error: '无法重置状态存储' }), {
            status: 500, // Internal Server Error
            headers: corsHeaders
        });
    }
}