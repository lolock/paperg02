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

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Only respond to requests starting with /api/
  if (!url.pathname.startsWith('/api/')) {
    return new Response('Not Found', { status: 404 });
  }

  // Handle CORS preflight requests first
  if (request.method === 'OPTIONS') {
    return handleOptions();
  }

  let response; // Variable to hold the eventual response object

  try {
    // --- Request Routing ---
    if (url.pathname === '/api/login' && request.method === 'POST') {
      response = await handleLoginRequest(request, env);
    } else if (url.pathname === '/api/chat' && request.method === 'POST') {
      response = await handleChatRequest(request, env);
    } else {
      // Route not found or method not allowed
      console.warn(`No matching route found for ${request.method} ${url.pathname}.`); // Keep warning for unmatched routes
      response = new Response(JSON.stringify({ error: 'API route not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Ensure we always have a Response object after the handler call
    if (!(response instanceof Response)) {
        console.error("Handler did not return a valid Response object. Assigning 500."); // Keep critical error
        response = new Response(JSON.stringify({ error: 'Internal Server Error: Invalid handler response' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

  } catch (error) {
    // Catch unexpected errors during request routing or handler execution itself
    console.error('Error during request handling or handler execution:', error); // Keep critical error
    response = new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Add CORS Headers to the final response ---
  const corsHeaders = {
      'Access-Control-Allow-Origin': '*', // Consider restricting in production
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  const responseHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
      responseHeaders.set(key, value);
  });

  // Return the final response
  return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
  });
}

/**
 * Handles CORS preflight requests (OPTIONS).
 */
function handleOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400',
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
  try {
    // Validate request
    if (!request.headers.get('content-type')?.includes('application/json')) {
       return new Response(JSON.stringify({ error: 'Invalid request body type. Expected JSON.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    let body;
    try { body = await request.json(); } catch (e) { return new Response(JSON.stringify({ error: 'Invalid JSON format in request body.'}), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
    const providedCode = body.code;
    if (!providedCode) {
       return new Response(JSON.stringify({ error: 'Login code is required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // --- KV Validation Logic ---
    if (!env.KV_NAMESPACE) {
        console.error("KV_NAMESPACE binding is not configured in environment."); // Keep critical config error
        return new Response(JSON.stringify({ error: 'Server configuration error: KV Namespace not bound.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const kvValue = await env.KV_NAMESPACE.get(providedCode);

    if (kvValue !== null) { // Key exists
      // console.log(`Successful login attempt with valid KV code: ${providedCode}`); // Optional: Keep if needed for audit
      return new Response(JSON.stringify({ success: true, message: 'Login successful.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } else { // Key does not exist
      console.warn(`Failed login attempt with non-existent KV code: ${providedCode}`); // Keep warning for failed attempts
      return new Response(JSON.stringify({ success: false, error: 'Invalid login code.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    // --- End of KV Validation ---

  } catch (error) {
    console.error('[handleLoginRequest] Unexpected error caught:', error); // Keep critical error
    return new Response(JSON.stringify({ error: 'Failed to process login request.', details: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}



/**
 * Handles the /api/chat POST request using KV validation, state management, and calling LLM API.
 * @param {Request} request
 * @param {object} env - Environment object
 * @returns {Promise<Response>}
 */
async function handleChatRequest(request, env) {
  let currentState = null; // 用于存储用户当前状态
  let loginCode = null; // 用于存储登录码

  try {
    // --- Input Validation ---
    if (!request.headers.get('content-type')?.includes('application/json')) {
        return new Response(JSON.stringify({ error: 'Invalid request body type. Expected JSON.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    let body;
    try {
        body = await request.json();
    } catch (jsonError) {
        console.error('[handleChatRequest] Failed to parse request JSON body:', jsonError); // Keep error
        return new Response(JSON.stringify({ error: 'Invalid JSON format in request body.', details: jsonError.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const userMessage = body.message;
    loginCode = body.code;
    if (!userMessage || !loginCode) {
        return new Response(JSON.stringify({ error: 'Message and login code are required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // --- Re-validate Login Code using KV ---
    if (!env.KV_NAMESPACE) {
        console.error("[handleChatRequest] KV_NAMESPACE binding is not configured."); // Keep critical config error
        return new Response(JSON.stringify({ error: 'Server configuration error: KV Namespace not bound.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    
    // --- 读取并解析状态 ---
    try {
      const kvValue = await env.KV_NAMESPACE.get(loginCode);
      if (kvValue === null) {
        console.warn(`[handleChatRequest] Invalid/non-existent KV code during chat: ${loginCode}`); // Keep warning
        return new Response(JSON.stringify({ error: 'Invalid or expired login code.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      
      // 尝试解析状态，如果不是有效的JSON或没有状态信息，则初始化
      try {
        currentState = JSON.parse(kvValue);
        // 验证状态对象结构
        if (!currentState || typeof currentState !== 'object') {
          throw new Error("Invalid state structure");
        }
      } catch (parseError) {
        // 初始化默认状态
        currentState = {
          status: 'AWAITING_INITIAL_INPUT',
          initial_requirements: null,
          outline: null,
          approved_outline: null,
          current_chapter_index: -1,
          confirmed_chapters: [],
          conversation_history: []
        };
        console.log(`[handleChatRequest] Initializing new state for ${loginCode}`);
      }
    } catch (kvError) {
      console.error(`[handleChatRequest] Error accessing KV state:`, kvError);
      return new Response(JSON.stringify({ error: 'Failed to access user state.', details: kvError.message }), 
        { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // --- Get Configuration ---
    const apiKey = env.OPENAI_API_KEY;
    const apiBaseUrl = env.API_ENDPOINT || "https://api.openai.com/v1"; // Default base URL
    const baseSystemPrompt = env.SYSTEM_PROMPT || "You are a helpful assistant.";
    const modelName = env.LLM_MODEL || "gpt-3.5-turbo";

    if (!apiKey) {
        console.error("[handleChatRequest] OPENAI_API_KEY environment variable not set."); // Keep critical config error
        return new Response(JSON.stringify({ error: 'Server configuration error: Missing API Key.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // --- Construct Full URL ---
    let fullApiUrl;
    try {
        let standardizedBaseUrl = apiBaseUrl.endsWith('/') ? apiBaseUrl.slice(0, -1) : apiBaseUrl;
        fullApiUrl = standardizedBaseUrl.endsWith('/v1')
            ? `${standardizedBaseUrl}/chat/completions`
            : `${standardizedBaseUrl}/v1/chat/completions`;
        new URL(fullApiUrl); // Validate URL
    } catch (urlError) {
        console.error(`[handleChatRequest] Invalid API_ENDPOINT format: ${apiBaseUrl}`, urlError); // Keep error
        return new Response(JSON.stringify({ error: 'Server configuration error: Invalid API Endpoint URL format.', details: urlError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // --- 状态机处理逻辑 ---
    let systemPrompt = baseSystemPrompt;
    let messages = [];
    let aiReply = "";
    let stateChanged = false;
    
    // 根据当前状态处理用户输入
    switch (currentState.status) {
      case 'AWAITING_INITIAL_INPUT':
        // 保存用户的初始需求
        currentState.initial_requirements = userMessage;
        currentState.status = 'GENERATING_OUTLINE';
        stateChanged = true;
        
        // 构建生成大纲的提示
        systemPrompt = "你是一个AI助手，负责根据用户需求生成详细的内容大纲。请以Markdown格式输出大纲，使用多级列表结构。";
        messages = [
          { role: "system", content: systemPrompt },
          { role: "user", content: `根据以下需求生成一个详细的内容大纲：\n\n${userMessage}` }
        ];
        break;
        
      case 'GENERATING_OUTLINE':
        // 这是一个中间状态，通常不会直接进入，但如果发生，我们可以提供反馈
        aiReply = "正在生成大纲，请稍候...";
        return new Response(JSON.stringify({ 
          reply: aiReply,
          state: { status: currentState.status }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        
      case 'AWAITING_OUTLINE_APPROVAL':
        // 处理用户对大纲的反馈
        const command = userMessage.trim().toUpperCase();
        
        if (command === 'C') { // 确认大纲
          currentState.approved_outline = currentState.outline;
          currentState.current_chapter_index = 0;
          currentState.status = 'GENERATING_CHAPTER';
          stateChanged = true;
          
          // 构建生成第一章内容的提示
          systemPrompt = "你是一个AI写作助手，负责根据已批准的大纲生成特定章节的内容。";
          messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: `已批准的大纲如下：\n\`\`\`\n${currentState.approved_outline}\n\`\`\`\n\n请生成第 ${currentState.current_chapter_index + 1} 章的完整内容。` }
          ];
        } else if (command === 'E') { // 编辑大纲
          aiReply = "请提供您希望如何修改大纲的具体建议。";
          currentState.status = 'EDITING_OUTLINE';
          stateChanged = true;
          
          return new Response(JSON.stringify({ 
            reply: aiReply,
            state: { status: currentState.status }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } else if (command === 'A') { // 放弃当前流程
          aiReply = "已放弃当前流程。请提供新的需求。";
          currentState = {
            status: 'AWAITING_INITIAL_INPUT',
            initial_requirements: null,
            outline: null,
            approved_outline: null,
            current_chapter_index: -1,
            confirmed_chapters: [],
            conversation_history: currentState.conversation_history || []
          };
          stateChanged = true;
          
          return new Response(JSON.stringify({ 
            reply: aiReply,
            state: { status: currentState.status }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } else { // 无法识别的命令
          aiReply = "请输入有效的命令：'C'确认大纲，'E'编辑大纲，或'A'放弃流程。";
          return new Response(JSON.stringify({ 
            reply: aiReply,
            state: { status: currentState.status }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        break;
        
      case 'EDITING_OUTLINE':
        // 用户提供了大纲修改建议，重新生成大纲
        currentState.status = 'GENERATING_OUTLINE';
        stateChanged = true;
        
        systemPrompt = "你是一个AI助手，负责根据用户的初始需求和修改建议生成改进的内容大纲。请以Markdown格式输出大纲。";
        messages = [
          { role: "system", content: systemPrompt },
          { role: "user", content: `初始需求：\n${currentState.initial_requirements}\n\n原始大纲：\n${currentState.outline}\n\n修改建议：\n${userMessage}\n\n请生成修改后的大纲。` }
        ];
        break;
        
      case 'AWAITING_CHAPTER_FEEDBACK':
        // 处理用户对章节内容的反馈
        const chapterCommand = userMessage.trim().toUpperCase();
        
        if (chapterCommand === 'C') { // 确认章节
          // 保存当前章节
          if (!currentState.confirmed_chapters) {
            currentState.confirmed_chapters = [];
          }
          
          // 假设最后一次AI回复是当前章节内容
          if (currentState.last_chapter_content) {
            currentState.confirmed_chapters.push({
              index: currentState.current_chapter_index,
              content: currentState.last_chapter_content
            });
          }
          
          // 移至下一章
          currentState.current_chapter_index++;
          
          // 检查是否还有更多章节
          const outlineLines = currentState.approved_outline.split('\n').filter(line => line.trim().length > 0);
          const estimatedChapters = Math.max(outlineLines.length / 2, 3); // 粗略估计章节数
          
          if (currentState.current_chapter_index >= estimatedChapters) {
            // 所有章节已完成
            aiReply = "所有章节已完成！您可以开始新的项目。";
            currentState.status = 'COMPLETED';
            stateChanged = true;
            
            return new Response(JSON.stringify({ 
              reply: aiReply,
              state: { status: currentState.status },
              chapters: currentState.confirmed_chapters
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          } else {
            // 生成下一章
            currentState.status = 'GENERATING_CHAPTER';
            stateChanged = true;
            
            systemPrompt = "你是一个AI写作助手，负责根据已批准的大纲生成特定章节的内容。";
            messages = [
              { role: "system", content: systemPrompt },
              { role: "user", content: `已批准的大纲如下：\n\`\`\`\n${currentState.approved_outline}\n\`\`\`\n\n请生成第 ${currentState.current_chapter_index + 1} 章的完整内容。` }
            ];
          }
        } else if (chapterCommand === 'E') { // 编辑章节
          aiReply = "请提供您希望如何修改本章内容的具体建议。";
          currentState.status = 'EDITING_CHAPTER';
          stateChanged = true;
          
          return new Response(JSON.stringify({ 
            reply: aiReply,
            state: { status: currentState.status }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } else if (chapterCommand === 'A') { // 放弃当前流程
          aiReply = "已放弃当前章节编辑。您想继续编辑大纲还是开始新的项目？请输入'O'继续编辑大纲或'N'开始新项目。";
          currentState.status = 'AWAITING_NEXT_ACTION';
          stateChanged = true;
          
          return new Response(JSON.stringify({ 
            reply: aiReply,
            state: { status: currentState.status }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } else { // 无法识别的命令
          aiReply = "请输入有效的命令：'C'确认章节，'E'编辑章节，或'A'放弃当前章节。";
          return new Response(JSON.stringify({ 
            reply: aiReply,
            state: { status: currentState.status }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        break;
        
      case 'EDITING_CHAPTER':
        // 用户提供了章节修改建议，重新生成章节
        currentState.status = 'GENERATING_CHAPTER';
        stateChanged = true;
        
        systemPrompt = "你是一个AI写作助手，负责根据用户的修改建议调整章节内容。";
        messages = [
          { role: "system", content: systemPrompt },
          { role: "user", content: `大纲：\n${currentState.approved_outline}\n\n原始第${currentState.current_chapter_index + 1}章内容：\n${currentState.last_chapter_content || "无原始内容"}\n\n修改建议：\n${userMessage}\n\n请生成修改后的第${currentState.current_chapter_index + 1}章内容。` }
        ];
        break;
        
      case 'AWAITING_NEXT_ACTION':
        // 处理用户选择下一步操作
        const nextAction = userMessage.trim().toUpperCase();
        
        if (nextAction === 'O') { // 继续编辑大纲
          aiReply = `当前大纲：\n\`\`\`\n${currentState.approved_outline || currentState.outline}\n\`\`\`\n\n请提供您希望如何修改大纲的具体建议。`;
          currentState.status = 'EDITING_OUTLINE';
          stateChanged = true;
          
          return new Response(JSON.stringify({ 
            reply: aiReply,
            state: { status: currentState.status }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } else if (nextAction === 'N') { // 开始新项目
          aiReply = "好的，请提供新项目的需求。";
          currentState = {
            status: 'AWAITING_INITIAL_INPUT',
            initial_requirements: null,
            outline: null,
            approved_outline: null,
            current_chapter_index: -1,
            confirmed_chapters: [],
            conversation_history: currentState.conversation_history || []
          };
          stateChanged = true;
          
          return new Response(JSON.stringify({ 
            reply: aiReply,
            state: { status: currentState.status }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } else { // 无法识别的命令
          aiReply = "请输入有效的命令：'O'继续编辑大纲或'N'开始新项目。";
          return new Response(JSON.stringify({ 
            reply: aiReply,
            state: { status: currentState.status }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        break;
        
      case 'GENERATING_CHAPTER':
        // 这是一个中间状态，通常不会直接进入
        aiReply = `正在生成第 ${currentState.current_chapter_index + 1} 章内容，请稍候...`;
        return new Response(JSON.stringify({ 
          reply: aiReply,
          state: { status: currentState.status }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        
      default:
        // 处理未知状态 - 重置到初始状态
        console.warn(`[handleChatRequest] Unknown state "${currentState.status}" for ${loginCode}, resetting.`);
        currentState = {
          status: 'AWAITING_INITIAL_INPUT',
          initial_requirements: null,
          outline: null,
          approved_outline: null,
          current_chapter_index: -1,
          confirmed_chapters: [],
          conversation_history: currentState.conversation_history || []
        };
        stateChanged = true;
        
        aiReply = "状态已重置。请提供您的需求。";
        return new Response(JSON.stringify({ 
          reply: aiReply,
          state: { status: currentState.status }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // --- 调用LLM API ---
    const llmRequestPayload = { model: modelName, messages: messages };
    
    const llmResponse = await fetch(fullApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(llmRequestPayload),
    });

    // --- Process LLM Response ---
    if (!llmResponse.ok) { // Handle non-2xx responses
        let errorText = `LLM API returned status ${llmResponse.status}`;
        try {
             const errorBody = await llmResponse.text();
             console.error(`[handleChatRequest] LLM API request failed body: ${errorBody}`); // Keep error log with body
             errorText = errorBody || errorText;
        } catch (e) { console.error("[handleChatRequest] Failed to read LLM error response body:", e); }
        // Return a structured error including details from the LLM API response
        return new Response(JSON.stringify({ error: 'Failed to get response from AI service.', llm_status: llmResponse.status, llm_details: errorText }), {
             status: 500, // Internal Server Error because *our* service couldn't fulfill the request via the upstream API
             headers: { 'Content-Type': 'application/json' }
         });
    }

    // --- Process OK response (2xx) ---
    let llmResult;
    try {
        llmResult = await llmResponse.json();
    } catch (jsonError) {
        console.error('[handleChatRequest] Failed to parse LLM JSON response:', jsonError); // Keep error
        // Attempt to log raw text if JSON parsing fails
        let rawText = "[Could not read raw text after JSON parse failure]";
        try { const responseClone = llmResponse.clone(); rawText = await responseClone.text(); console.error('[handleChatRequest] Raw response text:', rawText); } catch (textError) { /* ignore */ }
        return new Response(JSON.stringify({ error: 'Failed to parse AI response.', details: jsonError.message, raw_response: rawText }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // --- Extract reply ---
    aiReply = llmResult.choices?.[0]?.message?.content?.trim();
    // Add fallback for slightly different structures if necessary
     if (!aiReply) {
         aiReply = llmResult.response || llmResult.output || llmResult.text || llmResult.content;
         if (!aiReply && typeof llmResult === 'string') { aiReply = llmResult.trim(); }
     }

    if (!aiReply) {
        console.error('[handleChatRequest] Could not extract AI reply from parsed LLM response:', JSON.stringify(llmResult)); // Keep error
        return new Response(JSON.stringify({ error: 'Failed to parse AI response (content missing).', response_structure: JSON.stringify(llmResult) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // --- 更新状态 ---
    // 根据当前状态和LLM响应更新状态
    if (currentState.status === 'GENERATING_OUTLINE') {
      currentState.outline = aiReply;
      currentState.status = 'AWAITING_OUTLINE_APPROVAL';
      stateChanged = true;
      
      // 添加用户提示
      aiReply = `${aiReply}\n\n请检查以上大纲并回复：\n- 'C' 确认大纲\n- 'E' 编辑大纲\n- 'A' 放弃流程`;
    } else if (currentState.status === 'GENERATING_CHAPTER') {
      currentState.last_chapter_content = aiReply;
      currentState.status = 'AWAITING_CHAPTER_FEEDBACK';
      stateChanged = true;
      
      // 添加用户提示
      aiReply = `${aiReply}\n\n请检查以上第 ${currentState.current_chapter_index + 1} 章内容并回复：\n- 'C' 确认并继续下一章\n- 'E' 编辑本章内容\n- 'A' 放弃当前章节`;
    }
    
    // 记录对话历史
    if (!currentState.conversation_history) {
      currentState.conversation_history = [];
    }
    currentState.conversation_history.push({
      role: "user",
      content: userMessage
    });
    currentState.conversation_history.push({
      role: "assistant",
      content: aiReply
    });
    
    // 限制对话历史长度，防止KV值过大
    if (currentState.conversation_history.length > 20) {
      currentState.conversation_history = currentState.conversation_history.slice(-20);
    }
    
    // --- 持久化状态到KV ---
    if (stateChanged) {
      try {
        await env.KV_NAMESPACE.put(loginCode, JSON.stringify(currentState));
      } catch (kvError) {
        console.error(`[handleChatRequest] Failed to update state in KV for ${loginCode}:`, kvError);
        // 即使KV写入失败，我们仍然返回响应，但记录错误
      }
    }

    // --- 返回响应 ---
    return new Response(JSON.stringify({ 
      reply: aiReply,
      state: { 
        status: currentState.status,
        current_chapter_index: currentState.current_chapter_index
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[handleChatRequest] Unexpected error caught in try-catch block:', error); // Keep critical error
    return new Response(JSON.stringify({ error: 'Failed to process chat request.', details: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}