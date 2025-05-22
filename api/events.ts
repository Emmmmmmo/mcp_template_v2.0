import { App, LogLevel } from '@slack/bolt';
import { createParser } from 'eventsource-parser';
import { openai } from '../lib/openai.js';

export const config = { runtime: 'nodejs20.x', maxDuration: 60 };

const slack = new App({
  token: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  logLevel: LogLevel.INFO
});

for (const ev of ['message', 'app_mention'] as const) {
  slack.event(ev, async ({ event, client, context }) => {
    if ((event as any).subtype === 'bot_message') return;

    const text = (event as any).text?.replace(`<@${context.botUserId}>`, '').trim() ?? '';
    const thread_ts = (event as any).thread_ts ?? event.ts;

    const stream = await openai.responses.create({
      model: 'gpt-4o-mini',
      instructions: 'You are a concise but helpful Slack assistant. Prefer bullet points. Stay under 4000 chars.',
      input: text,
      stream: true,
      tools: [
        {
          type: 'mcp',
          server_label: 'deepwiki',
          server_url: process.env.MCP_DEEPWIKI_URL!
        }
      ]
    });

    const parser = createParser(async (evt) => {
      if (evt.type !== 'event') return;
      const data = JSON.parse(evt.data);

      if (data.type === 'text') {
        await client.chat.postMessage({
          channel: (event as any).channel,
          text: data.text,
          thread_ts
        });
      }

      if (data.type === 'tool') {
        const res = await fetch(`${data.server_url}/call_tool`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: data.name,
            arguments: data.parameters
          }),
          timeout: 30_000
        });

        const result = await res.json();

        await openai.responses.create({
          response_id: data.response_id,
          messages: [{ role: 'tool', name: data.name, content: result }]
        });
      }
    });

    for await (const chunk of stream) parser.feed(chunk);
  });
}

export default slack.start();
