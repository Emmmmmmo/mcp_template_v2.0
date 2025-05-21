import type { SlackEvent } from "@slack/web-api";
import {
  assistantThreadMessage,
  handleNewAssistantMessage,
} from "../lib/handle-messages";
import { waitUntil } from "@vercel/functions";
import { handleNewAppMention } from "../lib/handle-app-mention";
import { verifyRequest, getBotId } from "../lib/slack-utils";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const payload = JSON.parse(rawBody);
  const requestType = payload.type as "url_verification" | "event_callback";

  // See https://api.slack.com/events/url_verification
  if (requestType === "url_verification") {
    return new Response(JSON.stringify({ challenge: payload.challenge }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  await verifyRequest({ requestType, request, rawBody });

  try {
    const botUserId = await getBotId();
    console.log("Bot User ID:", botUserId);
    
    const event = payload.event;
    console.log(`Processing event: ${event.type}, channel_type: ${event.channel_type || 'n/a'}`);

    if (event.type === "app_mention") {
      console.log("Processing app mention");
      waitUntil(handleNewAppMention(event, botUserId));
    }
    else if (event.type === "assistant_thread_started") {
      console.log("Processing assistant thread started");
      waitUntil(assistantThreadMessage(event));
    }
    else if (event.type === "message") {
      // Handle both DMs and thread messages
      console.log(`Processing message event in ${event.channel_type || 'n/a'}`);
      
      if (event.user && event.user !== botUserId && !event.subtype) {
        waitUntil(handleNewAssistantMessage(event, botUserId));
      }
    }

    return new Response("Success!", { status: 200 });
  } catch (error) {
    console.error("Error in event processing:", error);
    return new Response("Error processing event", { status: 500 });
  }
}
