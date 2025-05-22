const OpenAI = require('openai');

exports.openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
