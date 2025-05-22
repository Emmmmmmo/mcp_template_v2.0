const { App, LogLevel } = require('@slack/bolt');
const { createParser } = require('eventsource-parser');
const { openai } = require('../lib/openai');

module.exports = async (req, res) => {
  // Initialize Slack app
  const slack = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    logLevel: LogLevel.INFO,
    receiver: {
      // Provide a custom receiver so we can handle requests manually
      dispatchEvent: async ({ body, headers }) => {
        await slack.processEvent({ body, headers });
      }
    }
  });

  // Start Slack event handlers
  for (const ev of ['message', 'app_mention']) {
    slack.event(ev, async ({ event, client, context }) => {
      if (event.subtype === 'bot_message') return;

      const text = event.text?.replace(`<@${context.botUserId}>`, '').trim() ?? '';
      const thread_ts = event.thread_ts ?? event.ts;

      const stream = await openai.responses.create({
        model: 'gpt-4o-mini',
        instructions: 'You are a concise but helpful Slack assistant. Prefer bullet points. Stay under 4000 chars.',
        input: text,
        stream: true,
        tools: [
          {
            type: 'mcp',
            server_label: 'deepwiki',
            server_url: process.env.MCP_DEEPWIKI_URL
          }
        ]
      });

      const parser = createParser(async (evt) => {
        if (evt.type !== 'event') return;
        const data = JSON.parse(evt.data);

        if (data.type === 'text') {
          await client.chat.postMessage({
            channel: event.channel,
            text: data.text,
            thread_ts
          });
        }

        if (data.type === 'tool') {
          const toolResponse = await fetch(`${data.server_url}/call_tool`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name: data.name,
              arguments: data.parameters
            }),
            timeout: 30000
          });

          const result = await toolResponse.json();

          await openai.responses.create({
            response_id: data.response_id,
            messages: [{ role: 'tool', name: data.name, content: result }]
          });
        }
      });

      for await (const chunk of stream) parser.feed(chunk);
    });
  }

  // Start the receiver manually
  await slack.start();

  // Respond to Vercel with basic acknowledgment
  res.status(200).send('OK');
};
