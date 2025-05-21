import { openai } from "@ai-sdk/openai";
import { CoreMessage, generateText, tool } from "ai";
import { z } from "zod";
import { exa } from "./utils";

// --- MCP SDK imports ---
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

/**
 * Dynamically load Zapier tools via the Model Context Protocol (MCP).
 */
async function getZapierTools(updateStatus?: (status: string) => void) {
  const zapierUrl = process.env.ZAPIER_MCP_URL;
  if (!zapierUrl) {
    updateStatus?.("Zapier MCP URL not set.");
    return {};
  }

  try {
    updateStatus?.("Connecting to Zapier MCP...");
    const client = new Client(
      { name: "slackbot-mcp-client", version: "1.0.0" },
      { capabilities: {} }
    );

    const transport = new SSEClientTransport(new URL(zapierUrl));
    await client.connect(transport);

    updateStatus?.("Fetching Zapier tools...");
    const toolsList = await Promise.race([
      client.listTools(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout fetching tools")), 10000)),
    ]);

    if (!Array.isArray(toolsList) || toolsList.length === 0) {
      updateStatus?.("No Zapier tools found or error fetching tools.");
      return {};
    }

    const zapierTools: Record<string, ReturnType<typeof tool>> = {};

    for (const zapTool of toolsList) {
      // Build a zod schema for the tool's parameters
      const paramsSchema = z.object(
        Object.fromEntries(
          (zapTool.params || []).map((param: string) => [param, z.any().optional()])
        )
      );

      // Wrap each Zapier tool with ai-sdk's tool() helper
      zapierTools[zapTool.name] = tool({
        name: zapTool.name,
        description: zapTool.description,
        parameters: paramsSchema,
        async execute(args: any) {
          updateStatus?.(`Calling Zapier tool: ${zapTool.name}...`);
          const result = await client.callTool({ name: zapTool.name, arguments: args });
          return result;
        },
      });
    }

    return zapierTools;
  } catch (error: any) {
    updateStatus?.(`Error fetching Zapier tools: ${error.message || error}`);
    return {};
  }
}

/**
 * Generates a response by invoking OpenAI with static and dynamic tools,
 * including the dynamically loaded Zapier actions.
 */
export const generateResponse = async (
  messages: CoreMessage[],
  updateStatus?: (status: string) => void,
) => {
  // Load Zapier tools dynamically
  const zapierTools = await getZapierTools(updateStatus);

  // Invoke the model with both static and dynamic tools
  const { text } = await generateText({
    model: openai("gpt-4o"),
    system: `You are a Slack bot assistant. Keep your responses concise and to the point.
- Do not tag users.
- Current date is: ${new Date().toISOString().split("T")[0]}
- Make sure to ALWAYS include sources in your final response if you use web search. Put sources inline if possible.`,
    messages,
    maxSteps: 10,
    tools: {
      // Static tools
      getWeather: tool({
        name: "getWeather",
        description: "Get the current weather at a location",
        parameters: z.object({ latitude: z.number(), longitude: z.number(), city: z.string() }),
        async execute({ latitude, longitude, city }) {
          updateStatus?.(`Fetching weather for ${city}...`);
          const resp = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weathercode,relativehumidity_2m&timezone=auto`,
          );
          const data = await resp.json();
          return { temperature: data.current.temperature_2m, weatherCode: data.current.weathercode, humidity: data.current.relativehumidity_2m, city };
        },
      }),
      searchWeb: tool({
        name: "searchWeb",
        description: "Search the web for information",
        parameters: z.object({ query: z.string(), specificDomain: z.string().nullable() }),
        async execute({ query, specificDomain }) {
          updateStatus?.(`Searching the web for \"${query}\"...`);
          const { results } = await exa.searchAndContents(query, { livecrawl: "always", numResults: 3, includeDomains: specificDomain ? [specificDomain] : undefined });
          return { results: results.map(r => ({ title: r.title, url: r.url, snippet: r.text.slice(0, 1000) })) };
        },
      }),
      // Dynamic Zapier tools
      ...zapierTools,
    },
  });

  // Convert markdown links to Slack mrkdwn and return
  return text.replace(/\[(.*?)\]\((.*?)\)/g, "<$2|$1>").replace(/\*\*/g, "*");
};
