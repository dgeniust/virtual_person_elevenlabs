import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import { promises as fs } from "fs";
import { GoogleGenerativeAI, Schema } from "@google/generative-ai";

// @ts-ignore - Bỏ qua cảnh báo type nếu elevenlabs-node không có @types
import voice from "elevenlabs-node";

dotenv.config();

// Khởi tạo Gemini thay vì OpenAI
const geminiApiKey = process.env.GEMINI_API_KEY || "-";
const genAI = new GoogleGenerativeAI(geminiApiKey);

const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = process.env.ELEVEN_LABS_VOICE_ID; // Giữ nguyên voice ID của bạn

const app = express();
app.use(express.json());
app.use(cors());
const port = 3000;

// Khai báo Interface cho cấu trúc dữ liệu
interface ChatMessage {
  text: string;
  facialExpression: string;
  animation: string;
  audio?: string;
  lipsync?: any;
}

app.get("/", (req: Request, res: Response) => {
  res.send("Hello World!");
});

app.get("/voices", async (req: Request, res: Response) => {
  try {
    const voices = await voice.getVoices(elevenLabsApiKey);
    res.send(voices);
  } catch (error) {
    res.status(500).send("Error fetching voices");
  }
});

const execCommand = (command: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      resolve(stdout);
    });
  });
};

const lipSyncMessage = async (messageIndex: number): Promise<void> => {
  const time = new Date().getTime();
  console.log(`Starting conversion for message ${messageIndex}`);

  await execCommand(
    `ffmpeg -y -i audios/message_${messageIndex}.mp3 audios/message_${messageIndex}.wav`,
  );
  console.log(`Conversion done in ${new Date().getTime() - time}ms`);

  await execCommand(
    `bin\\rhubarb.exe -f json -o audios/message_${messageIndex}.json audios/message_${messageIndex}.wav -r phonetic`,
  );
  console.log(`Lip sync done in ${new Date().getTime() - time}ms`);
};

const readJsonTranscript = async (file: string): Promise<any> => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

const audioFileToBase64 = async (file: string): Promise<string> => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};

app.post("/chat", async (req: Request, res: Response) => {
  const userMessage: string = req.body.message;

  if (!userMessage) {
    res.send({
      messages: [
        {
          text: "Hey dear... How was your day?",
          audio: await audioFileToBase64("audios/intro_0.wav"),
          lipsync: await readJsonTranscript("audios/intro_0.json"),
          facialExpression: "smile",
          animation: "Talking_1",
        },
        {
          text: "I missed you so much... Please don't go for so long!",
          audio: await audioFileToBase64("audios/intro_1.wav"),
          lipsync: await readJsonTranscript("audios/intro_1.json"),
          facialExpression: "sad",
          animation: "Crying",
        },
      ] as ChatMessage[],
    });
    return;
  }

  if (!elevenLabsApiKey || geminiApiKey === "-") {
    res.send({
      messages: [
        {
          text: "Please my dear, don't forget to add your API keys!",
          audio: await audioFileToBase64("audios/api_0.wav"),
          lipsync: await readJsonTranscript("audios/api_0.json"),
          facialExpression: "angry",
          animation: "Angry",
        },
        {
          text: "You don't want to ruin Wawa Sensei with a crazy Gemini and ElevenLabs bill, right?",
          audio: await audioFileToBase64("audios/api_1.wav"),
          lipsync: await readJsonTranscript("audios/api_1.json"),
          facialExpression: "smile",
          animation: "Laughing",
        },
      ] as ChatMessage[],
    });
    return;
  }

  try {
    // Cấu hình Model Gemini (Sử dụng gemini-1.5-flash cho tốc độ phản hồi nhanh)
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 1000,
        responseMimeType: "application/json", // Ép mô hình trả về JSON
      },
    });

    const prompt = `
      You are a virtual girlfriend.
      You will always reply with a JSON array of messages. With a maximum of 3 messages.
      Each message has a 'text', 'facialExpression', and 'animation' property.
      The different facial expressions are: smile, sad, angry, surprised, funnyFace, and default.
      The different animations are: Talking_0, Talking_1, Talking_2, Crying, Laughing, Rumba, Idle, Terrified, and Angry. 
      
      User message: "${userMessage}"
      
      Return ONLY a JSON object with a "messages" array containing the response.
    `;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    let parsedData = JSON.parse(responseText);
    let messages: ChatMessage[] = parsedData.messages
      ? parsedData.messages
      : parsedData;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const fileName = `audios/message_${i}.mp3`;
      const textInput = message.text;

      // 1. Generate audio file
      await voice.textToSpeech(elevenLabsApiKey, voiceID, fileName, textInput);

      // 2. Generate lipsync
      await lipSyncMessage(i);

      // 3. Gắn dữ liệu vào response (chuyển thành Base64 và Object)
      message.audio = await audioFileToBase64(fileName);
      message.lipsync = await readJsonTranscript(`audios/message_${i}.json`);

      // 4. DỌN DẸP: Xóa các file vật lý ngay sau khi đã đọc xong
      try {
        await fs.unlink(fileName); // Xóa file .mp3
        await fs.unlink(`audios/message_${i}.wav`); // Xóa file .wav
        await fs.unlink(`audios/message_${i}.json`); // Xóa file .json
        console.log(`Đã dọn dẹp xong các file tạm của message_${i}`);
      } catch (cleanupError) {
        console.error(`Lỗi khi xóa file tạm message_${i}:`, cleanupError);
      }
    }

    res.send({ messages });
  } catch (error) {
    console.error("Error during chat processing:", error);
    res
      .status(500)
      .send({ error: "An error occurred while processing your request." });
  }
});

app.listen(port, () => {
  console.log(`Virtual Girlfriend listening on port ${port}`);
});
