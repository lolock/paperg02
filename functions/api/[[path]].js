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
async function handleChatRequest(request, env, userCode) {
    console.log(`Handling chat request from: ${request.headers.get('CF-Connecting-IP')}`);
    let requestPayload;
    // Define standard Content-Type header for JSON responses inside this function scope
    // Note: Ensure corsHeaders is accessible (defined globally or passed).
    const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

    try {
        requestPayload = await request.json();
        if (!requestPayload.code || !requestPayload.message) {
            throw new Error("Missing 'code' or 'message' in request body");
        }
        console.log(`Chat request received for code ${requestPayload.code}`);
    } catch (error) {
        console.error('Error parsing chat request body:', error);
        // Use local jsonHeaders
        return new Response(JSON.stringify({ error: '无效的请求体' }), { status: 400, headers: jsonHeaders });
    }

    const { message: userMessage, code: loginCode } = requestPayload;

    try {
        // --- 1. Load Current State & History ---
        console.log(`Loading state for ${loginCode} from KV...`);
        const storedStateString = await env.KV_NAMESPACE.get(loginCode);

        if (!storedStateString) {
            console.error(`No state found in KV for code ${loginCode}. User might not be logged in properly.`);
            // Use local jsonHeaders
            return new Response(JSON.stringify({ error: '未找到会话状态，请尝试重新登录' }), { status: 404, headers: jsonHeaders });
        }

        let currentState;
        try {
            currentState = JSON.parse(storedStateString);
            if (!Array.isArray(currentState.conversation_history)) {
                 console.warn(`conversation_history missing or not an array for ${loginCode}. Initializing.`);
                 currentState.conversation_history = [];
            }
            console.log(`State for ${loginCode} loaded. Current status: ${currentState.status}`);
        } catch (parseError) {
            console.error(`Error parsing stored state for ${loginCode} during chat:`, parseError);
             // Use local jsonHeaders
            return new Response(JSON.stringify({ error: '无法解析会话状态' }), { status: 500, headers: jsonHeaders });
        }

        // --- 2. Append User Message to History ---
        currentState.conversation_history.push({ role: 'user', content: userMessage });
        console.log(`Appended user message to history. History length: ${currentState.conversation_history.length}`);

        let aiReply = null; // Initialize AI reply variable

        // --- 3. Determine Action based on State & Potentially Call LLM ---

        // {{ 编辑 1: 读取两个 Prompt (Secret 和 Plaintext 都可以通过 env 访问) }}
        const paperSystemPrompt = env.PAPER_SYSTEM_PROMPT; // 从 Secret 读取
        const generalSystemPrompt = env.SYSTEM_PROMPT;    // 从 Plaintext 读取

        // {{ 编辑 2: 检查两个 Prompt 是否都已设置 }}
        if (!paperSystemPrompt || !generalSystemPrompt) {
            console.error("错误：PAPER_SYSTEM_PROMPT 或 SYSTEM_PROMPT 环境变量未设置。请在 Cloudflare Dashboard 或 wrangler.toml 中进行配置。");
            // 根据需要返回错误，确保 jsonHeaders 在此作用域内可用
            return new Response(JSON.stringify({ error: '服务器配置错误：必要的系统提示缺失' }), {
                status: 500,
                headers: jsonHeaders // 假设 jsonHeaders 已在此作用域定义
            });
        }

        // {{ 编辑 3: 合并两个 Prompt 内容，可以调整顺序和分隔符 }}
        // 这里将 PAPER_SYSTEM_PROMPT 放在前面，用分隔符区分
        const combinedPromptContent = `${paperSystemPrompt}\n\n---\n\n${generalSystemPrompt}\n当前状态: ${currentState.status}`;

        const systemPrompt = { role: 'system', content: combinedPromptContent };

        // Use the updated conversation history after appending the user message
        const llmMessages = [ systemPrompt, ...currentState.conversation_history ];

        // --- State Machine Logic (IF statements for status transitions) ---
        if (currentState.status === 'AWAITING_INITIAL_INPUT') {
            currentState.status = 'GENERATING_OUTLINE';
            console.log(`Status -> GENERATING_OUTLINE`);
        } else if (currentState.status === 'AWAITING_OUTLINE_APPROVAL') {
            // {{ 编辑 1: 将 'C' 的检查改为检查 '继续' }}
            if (userMessage.trim() === '继续') { // 原为: userMessage.trim().toUpperCase() === 'C'
                currentState.status = 'GENERATING_CHAPTER';
                currentState.current_chapter_index = 0;
                console.log(`Outline approved. Status -> GENERATING_CHAPTER, Index -> 0`);
            } else {
                currentState.status = 'GENERATING_OUTLINE';
                console.log(`Outline feedback received. Status -> GENERATING_OUTLINE`);
            }
        } else if (currentState.status === 'AWAITING_CHAPTER_FEEDBACK') {
            const chapterNum = currentState.current_chapter_index + 1;
            // {{ 编辑 2: 将 'C' 的检查改为检查 '继续' }}
            if (userMessage.trim() === '继续') { // 原为: userMessage.trim().toUpperCase() === 'C'
                // ... (save chapter, increment index, check completion) ...
                currentState.confirmed_chapters.push({
                    index: currentState.current_chapter_index,
                    content: currentState.last_chapter_content || "内容未记录"
                });
                currentState.current_chapter_index++;
                console.log(`Chapter ${chapterNum} approved. Saved. Index -> ${currentState.current_chapter_index}`);
                // ... (estimate chapters if needed) ...
                if (currentState.approved_outline && !currentState.estimated_chapters) {
                    const outlineLines = currentState.approved_outline.split('\n').filter(line => line.trim().length > 0);
                    currentState.estimated_chapters = Math.max(Math.floor(outlineLines.length / 2), 1);
                    console.log(`Estimated chapters based on outline: ${currentState.estimated_chapters}`);
                }
                // ... (check completion) ...
                if (currentState.estimated_chapters && currentState.current_chapter_index >= currentState.estimated_chapters) {
                     currentState.status = 'COMPLETED';
                     console.log(`All estimated chapters completed. Status -> COMPLETED`);
                     aiReply = "所有章节已根据大纲完成。流程结束。"; // Set completion reply
                } else {
                    currentState.status = 'GENERATING_CHAPTER';
                    console.log(`Status -> GENERATING_CHAPTER for index ${currentState.current_chapter_index}`);
                }
            } else {
                currentState.status = 'GENERATING_CHAPTER'; // Regenerate same chapter
                console.log(`Chapter ${chapterNum} feedback received. Regenerating. Status -> GENERATING_CHAPTER`);
            }
        }
        // End of state machine logic structure example


        // Handle CANCELED/COMPLETED states where no LLM call is needed
        if (currentState.status === 'COMPLETED') {
            // aiReply might have been set already in the state machine
              if (aiReply === null) { // If not set previously
                 aiReply = "流程已完成。";
              }
        } else if (currentState.status === 'GENERATING_OUTLINE' || currentState.status === 'GENERATING_CHAPTER') {
            // --- Call LLM ---
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
                        messages: llmMessages, // Use the messages array built earlier
                        stream: false
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

                // {{** EDIT 2: Directly use LLM output, assuming Prompt enforces Markdown **}}
                aiReply = llmData.choices[0].message.content.trim();
                if (!aiReply) {
                    console.warn("LLM returned an empty reply.");
                    aiReply = "(AI 未返回有效内容)";
                }
                console.log("LLM processing successful (assuming Markdown format).");

                // --- Update State based on LLM response ---
                if (currentState.status === 'GENERATING_OUTLINE') {
                    // {{** EDIT 3: Store the assumed Markdown outline directly **}}
                    currentState.approved_outline = aiReply;
                    currentState.status = 'AWAITING_OUTLINE_APPROVAL';
                    console.log(`Outline generated. Status -> AWAITING_OUTLINE_APPROVAL`);
                } else if (currentState.status === 'GENERATING_CHAPTER') {
                     // {{** EDIT 4: Store the assumed Markdown chapter content directly **}}
                     currentState.last_chapter_content = aiReply;
                    currentState.status = 'AWAITING_CHAPTER_FEEDBACK';
                    console.log(`Chapter ${currentState.current_chapter_index + 1} generated. Status -> AWAITING_CHAPTER_FEEDBACK`);
                }

            } catch (llmError) {
                console.error('Error during LLM API call:', llmError);
                aiReply = `抱歉，在调用 AI 服务时出错: ${llmError.message}`;
                // Consider reverting state if LLM fails? Or keep it as GENERATING?
                // If keeping GENERATING, the next user message might retry.
                // If reverting, need to decide which state to revert to (e.g., AWAITING_INITIAL_INPUT).
                // For now, keeps state, returns error message.
            }
        } // End LLM call block

        // --- 4. Append AI Reply to History (if applicable) ---
        if (aiReply !== null) {
           // Only append if we actually got a reply (from LLM or canned response like "COMPLETED")
           currentState.conversation_history.push({ role: 'assistant', content: aiReply });
           console.log(`Appended assistant message to history. History length: ${currentState.conversation_history.length}`);
        } else if (currentState.status !== 'AWAITING_INITIAL_INPUT') {
            // Handle unexpected cases where no reply was generated but status indicates one was expected
            console.warn(`Reached end of chat handler for status ${currentState.status} without generating an AI reply.`);
            aiReply = "内部处理错误，未能生成回复。"; // Provide a default error message
            currentState.conversation_history.push({ role: 'assistant', content: aiReply });
        }

        // --- 5. Save Updated State & History Back to KV ---
        // Ensure state is always saved, even if aiReply is null (e.g., user just gave input)
        console.log(`Saving updated state for ${loginCode} to KV. Status: ${currentState.status}`);
        await env.KV_NAMESPACE.put(loginCode, JSON.stringify(currentState));
        console.log(`State for ${loginCode} successfully saved.`);

        // --- 6. Return Response to Frontend ---
        // {{** EDIT 5: Simplify the response structure **}}
        return new Response(JSON.stringify({
            reply: aiReply, // Send the generated AI reply (or null if none)
            state: {
                status: currentState.status,
                current_chapter_index: currentState.current_chapter_index
            }
        }), {
            status: 200,
            // {{** EDIT 6: Use jsonHeaders defined at the start of this function **}}
            headers: jsonHeaders // Use local jsonHeaders (contains CORS + Content-Type)
        });

    } catch (error) {
        console.error(`Unhandled error in handleChatRequest for code ${loginCode}:`, error);
        // {{** EDIT 7: Ensure error responses also use local jsonHeaders **}}
        // Use local jsonHeaders (contains CORS + Content-Type)
        return new Response(JSON.stringify({ error: `服务器内部错误: ${error.message}` }), {
            status: 500,
            headers: jsonHeaders
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