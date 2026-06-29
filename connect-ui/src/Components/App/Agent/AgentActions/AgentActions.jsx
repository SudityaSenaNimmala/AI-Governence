import axios from "axios";
import { EventAPIRequest } from "../../../helpers/EventAPIRequest";

export const getAIChatResponse = async (prompt) => {
  let res = await EventAPIRequest({
    method: "POST",
    path: `/ask?prompt=${prompt}`,
    body: "",
  });
  
  (res);

  return res;
};

export const getGeminiAIChatResponse = async (prompt) => {
  let res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyCXuFtQCshrlQDcyueq8TGcHUOT9HSaDyg`,
    {
      contents: [
        {
          parts: [
            {
              text: `Use only the find query. The SaaSUser collection contains users present in SaaS applications like Slack and Microsoft Teams, where the SaaS application name is mapped to the vendor keyword. The CFConnectApp collection stores all connected applications for a SaaS application, with the SaaS application name also mapped to the vendor keyword. ${prompt}, ensuring that the vendor name is represented as GOOGLE_WORKSPACE. Do not add any projections and extra information in the response.`,
            },
          ],
        },
      ],
    }
  );
  console.log(res);
  return res.data;
};

export const getAIChatResponse2 = async (prompt, vendor) => {
  let returnData, status, statusCode, responseHeaders;
  // vendor: vendor,
  // domain: "sacontain",
  try {
    let res = await axios.post(`https://aiagent.cloudfuze.com/query`, {
      query: prompt,
    });
    status = "OK";
    returnData = res?.data;
    statusCode = res?.status;
    responseHeaders = res?.headers;
  } catch (err) {
    status = "ERROR";
    statusCode = err.response?.status;
    responseHeaders = err?.headers;
  }
  return {
    status: status,
    res: returnData,
    statusCode: statusCode,
    headers: responseHeaders,
  };
};

export const getAIChatResponseStream = async (prompt) => {
  let res = await axios.post(
    `https://8988-2401-4900-889d-dfb7-71ab-522-dfd9-9cc9.ngrok-free.app/api/generate`,
    {
      model: "llama2",
      prompt:
        "Translate this natural language request into a MongoDB query. \n\n Also include the collection name in this format: 'COLLECTION:<collection_name>'.\n\n 'SaaSUser' is the collection where users present in SaaS Application like Slack, Microsoft Teams and Saas Application name is mapped to vendor key word and create a mongo query to fetch users based on vendor.\n\nGet me the list of SaaS Users in Slack \n\n In response i want only mongo query",
      stream: true,
    }
  );

  let nRes = new ReadableStream({
    start(controller) {
      const reader = res.data.getReader();
      let decoder = new TextDecoder();
      let buffer = "";
      reader.read().then(function processText({ done, value }) {
        if (done) {
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        lines.forEach((line) => {
          controller.enqueue(line);
        });
        reader.read().then(processText);
      });
    },
  });

  console.log(nRes);

  console.log(res);
  console.log(new TextDecoder().decode(res.data));
};
