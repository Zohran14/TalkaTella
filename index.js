import Fastify from "fastify";
import WebSocket from "ws";
import dotenv from "dotenv";
import fastifyWs from "@fastify/websocket";
import decodeAudio from "audio-decode";
import fs from "fs";
import path from "path";
import fastifyStatic from "@fastify/static";
// let num = 1;
// const writeStream = fs.createWriteStream("audio.txt", { flags: "a" });

const session = new Map();
function pcmToWav(pcmBuffer, sampleRate = 24000, channels = 1) {
  const byteRate = sampleRate * channels * 2; // 16 bits per sample
  const wavHeader = Buffer.alloc(44);
  const totalDataLen = pcmBuffer.length + 36; // 36 for the header + data

  // Fill in the WAV header
  wavHeader.write("RIFF", 0); // Chunk ID
  wavHeader.writeUInt32LE(totalDataLen, 4); // Chunk size
  wavHeader.write("WAVE", 8); // Format
  wavHeader.write("fmt ", 12); // Subchunk1 ID
  wavHeader.writeUInt32LE(16, 16); // Subchunk1 size (16 for PCM)
  wavHeader.writeUInt16LE(1, 20); // Audio format (PCM)
  wavHeader.writeUInt16LE(channels, 22); // Number of channels
  wavHeader.writeUInt32LE(sampleRate, 24); // Sample rate
  wavHeader.writeUInt32LE(byteRate, 28); // Byte rate
  wavHeader.writeUInt16LE(channels * 2, 32); // Block align
  wavHeader.writeUInt16LE(16, 34); // Bits per sample
  wavHeader.write("data", 36); // Subchunk2 ID
  wavHeader.writeUInt32LE(pcmBuffer.length, 40); // Subchunk2 size

  // Combine header and PCM data into one buffer
  const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);
  return wavBuffer;
}
function handleAudio(data) {
  const binary = Buffer.from(data, "base64");
  const wav = pcmToWav(binary);
  return wav;
}
// Function to save PCM data to a file
function savePCMToFile(pcm) {
  // writeStream.write(base64);
  fs.writeFile("audio.pcm", pcm, (err) => {
    if (err) throw err;
    console.log("The file is created if not existing!!");
  });
}

function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

// Converts a Float32Array to base64-encoded PCM16 data
function base64EncodeAudio(float32Array) {
  const arrayBuffer = floatTo16BitPCM(float32Array);
  let binary = "";
  let bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000; // 32KB chunk size
  for (let i = 0; i < bytes.length; i += chunkSize) {
    let chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

dotenv.config();
const LOG_EVENT_TYPES = [
  "response.content.done",
  "rate_limits.updated",
  "response.done",
  "input_audio_buffer.committed",
  "input_audio_buffer.speech_stopped",
  "input_audio_buffer.speech_started",
  "session.created",
  "response.text.done",
];

// Retrieve the OpenAI API key from environment variables
const { OPENAI_API_KEY } = process.env;

if (!OPENAI_API_KEY) {
  console.error(
    "Error: OpenAI API key is missing. Please configure it in the .env file."
  );
  process.exit(1);
}

const VOICE = "alloy";

// Initialize Fastify
const fastify = Fastify({
  logger: true,
});
fastify.register(fastifyStatic, {
  root: path.join(path.resolve(), "./dist"),
});

// this will work with fastify-static and send ./static/index.html
fastify.setNotFoundHandler((req, res) => {
  res.sendFile("index.html");
});
fastify.register(fastifyWs);
fastify.register(async function (fastify) {
  fastify.get("/media-stream", { websocket: true }, (connection, req) => {
    console.log("Client connected to /media-stream");

    const openAiWs = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01",
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1",
        },
      }
    );

    const sendSessionUpdate = (instructions) => {
      const sessionUpdate = {
        type: "session.update",
        session: {
          turn_detection: { type: "server_vad" },
          input_audio_format: "pcm16", // Match the browser audio format
          output_audio_format: "pcm16",
          voice: VOICE,
          instructions,
          modalities: ["text", "audio"],
          temperature: 0.8,
        },
      };

      console.log(
        "Sending session update to OpenAI API:",
        JSON.stringify(sessionUpdate)
      );
      openAiWs.send(JSON.stringify(sessionUpdate));
    };

    openAiWs.on("open", () => {
      session.set(connection, "");
      console.log("Connected to the OpenAI Realtime API");
    });
    openAiWs.on("error", (err) => {
      console.error("Error from jadlfjaocjaojfoajfo", err);
    });
    openAiWs.on("message", (data) => {
      try {
        const response = JSON.parse(data);
        console.log("Received message from OpenAI API:", response);

        if (LOG_EVENT_TYPES.includes(response.type)) {
          // console.log(`Received event of type: ${response.type}`, response);
        }
        if (response.type === "response.audio.delta") {
          // console.log("zohran", response);
          const result = response.delta;
          if (result) {
            console.log("recieved audio from openai");
            console.log("Forwarding audio delta to the frontend");
            console.log("Abbas1", result);
            const currentBase64 = session.get(connection);
            const newBase64 = currentBase64 + result;

            session.set(connection, newBase64);
            // num++;
            // connection.send(
            //   JSON.stringify({ event: "audio_response", audio: response.delta })
            // );
          }
        }
        if (response.type === "response.done") {
          // writeStream.end();
          console.log("done", "zboss");
          const base64 = session.get(connection);
          session.set(connection, "");
          const wav = handleAudio(base64);
          connection.send(
            JSON.stringify({ event: "audio_response", audio: wav })
          );
        }

        // Send the text response to the browser
        if (response.type === "response.audio_transcript.done") {
          console.log("recieved text from openai", response);
          connection.send(
            JSON.stringify({
              event: "text_response",
              text: response.transcript,
            })
          );
        }
      } catch (error) {
        console.error(
          "Error processing OpenAI message:",
          error,
          "Raw message:",
          data
        );
      }
    });

    connection.on("message", async (message) => {
      try {
        //JSONParse
        const data = JSON.parse(message);
        console.log(data);
        if (data.languageFrom && data.languageTo) {
          sendSessionUpdate(
            `You are a helpful translator that will translate a message between two languages: ${data.languageFrom} and ${data.languageTo}. If the user speaks in ${data.languageFrom}, then answer in ${data.languageTo}, and vice versa. If a question is asked, DO NOT answer it, instead translate it word for word.`
          );
        }
      } catch {
        try {
          // console.log(err);
          // convert to PCM ****
          console.log(message);
          const parsedMessage = new Uint8Array(message);
          const audioBuffer = await decodeAudio(parsedMessage);
          const channelData = audioBuffer.getChannelData(0); // only accepts mono
          const data = base64EncodeAudio(channelData);

          console.log(
            "Processing media event from frontend",
            openAiWs.readyState
          );
          if (openAiWs.readyState === WebSocket.OPEN) {
            const audioAppend = {
              type: "input_audio_buffer.append",
              audio: data,
            };
            console.log("Sending audio buffer to OpenAI API");
            openAiWs.send(JSON.stringify(audioAppend));
          }
        } catch (error) {
          console.error(
            "Error parsing message from frontend:",
            error,
            "Message:",
            message
          );
        }
      }
    });

    connection.on("close", () => {
      if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      console.log("Client disconnected from /media-stream");
    });

    openAiWs.on("close", () => {
      console.log("Disconnected from the OpenAI Realtime API");
    });

    openAiWs.on("error", (error) => {
      console.error("Error in OpenAI WebSocket connection:", error);
    });
  });
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: "0.0.0.0" });
    console.log("Fastify server started on port 3000");
  } catch (err) {
    fastify.log.error("Server startup error:", err);
    process.exit(1);
  }
};

start();
