# chatgpt-mcp 설치 프롬프트 (Claude에게 붙여넣기용)

이 파일의 프롬프트를 **Claude Desktop / Claude Code 등 파일·터미널에 접근할 수 있는 클로드**에게
그대로 복사해서 붙여넣으면, `chatgpt-mcp` 서버를 알아서 설치·설정해 줍니다.

> ⚠️ 프롬프트 안의 `sk-...` 부분에 **본인의 새 OpenAI API 키**를 직접 채워 넣으세요.
> 키는 공개된 채팅이 아니라, 클로드가 로컬에서 작업하는 창에만 입력하세요.

---

## A. Claude 데스크탑 앱에서 쓰기 (로컬 stdio)

가장 일반적인 방식입니다. 아래를 그대로 붙여넣으세요.

```text
chatgpt-mcp MCP 서버를 내 Claude 데스크탑 앱에 설치해줘. 다음 순서로 해줘:

1. 이 저장소를 클론(또는 이미 있으면 최신화)해줘:
   https://github.com/poshchloe1/notion-enhancer (브랜치: claude/chatgpt-mcp-integration-PUprZ)
   서버 코드는 그 안의 chatgpt-mcp/ 폴더에 있어.

2. chatgpt-mcp 폴더에서 `npm install`을 실행해줘. (Node.js 18 이상 필요)

3. 내 Claude 데스크탑 설정 파일 claude_desktop_config.json 을 찾아서
   (없으면 만들고) mcpServers 항목에 아래를 추가해줘.
   command의 args 경로는 방금 클론한 chatgpt-mcp/src/index.js의 절대경로로 바꿔줘:

   {
     "mcpServers": {
       "chatgpt": {
         "command": "node",
         "args": ["/절대경로/chatgpt-mcp/src/index.js"],
         "env": {
           "OPENAI_API_KEY": "sk-여기에-내-OpenAI-키",
           "OPENAI_MODEL": "gpt-4o-mini"
         }
       }
     }
   }

4. 설정 파일은 절대 깃에 커밋하지 마. 키는 이 설정 파일에만 둬.

5. 다 되면 "Claude 데스크탑 앱을 재시작하라"고 알려줘.
   재시작 후 chatgpt_ask / chatgpt_chat 도구가 보이면 성공이야.

이 서버는 ChatGPT(OpenAI)에 프롬프트를 넘겨서, 답변 생성은 OpenAI 쪽에서
일어나고 토큰도 내 OpenAI 키로 청구되게 해줘. Claude 토큰은 거의 안 써.
```

---

## B. Claude 폰/웹 앱에서 쓰기 (원격 HTTP 커넥터)

폰은 로컬 프로세스를 못 띄우므로, 서버를 어딘가에 띄워두고 "커스텀 커넥터"로 연결합니다.
서버를 호스팅하거나 터널로 노출하는 작업을 클로드에게 시키려면 아래를 붙여넣으세요.

```text
chatgpt-mcp MCP 서버를 내 Claude 폰/웹 앱에서 쓸 수 있게 HTTP 모드로 띄워줘.

1. https://github.com/poshchloe1/notion-enhancer 의
   claude/chatgpt-mcp-integration-PUprZ 브랜치를 클론하고,
   chatgpt-mcp/ 폴더에서 `npm install` 해줘.

2. 아래 환경변수로 서버를 HTTP 모드로 실행해줘
   (MCP_AUTH_TOKEN은 길고 무작위인 비밀값으로 새로 만들어줘):

   MCP_TRANSPORT=http \
   PORT=3000 \
   OPENAI_API_KEY=sk-여기에-내-OpenAI-키 \
   MCP_AUTH_TOKEN=길고-무작위인-비밀값 \
   node chatgpt-mcp/src/index.js

3. 이걸 폰에서 접근하려면 HTTPS 주소가 필요해. 빠르게 테스트하려면
   cloudflared 나 ngrok 으로 http://localhost:3000 을 터널링해서
   https URL을 만들어줘. (예: `cloudflared tunnel --url http://localhost:3000`)
   장기 운영이면 Render/Fly.io/VPS+Caddy 같은 호스팅 방법을 안내해줘.

4. 완성된 MCP 엔드포인트 URL(https://.../mcp)과
   내가 Claude 앱에 넣어야 할 Authorization 헤더 값(Bearer <비밀값>)을 알려줘.

그러면 내가 Claude 앱에서
설정 → 커넥터 → 커스텀 커넥터 추가 로 그 URL과 토큰을 등록할게.
```

---

## C. 설치 후 사용 예시 (클로드와 대화할 때)

```text
chatgpt_ask 도구로 GPT-4o에게 "바다에 관한 하이쿠 하나 써줘"라고 물어봐줘.
```

```text
chatgpt_chat 도구를 conversation_id "plan"으로 써서 여행 계획을 같이 세우자.
계속 같은 id로 이어가줘.
```

각 답변 끝에는 `tokens: N in + M out = T total (billed to your OpenAI account)`
형태로 OpenAI에 청구된 토큰량이 표시됩니다.
