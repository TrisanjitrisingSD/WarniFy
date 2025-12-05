import { clerkClient } from "@clerk/express";
import sql from "../configs/db.js";
import dotenv from 'dotenv'
import axios from 'axios'
import { v2 as cloudinary } from 'cloudinary'
import fs from 'fs'
import pdf from 'pdf-parse/lib/pdf-parse.js'
import { GoogleGenAI } from "@google/genai";

dotenv.config();


// const AI = new OpenAI({
//   apiKey: process.env.GEMINI_API_KEY,
//   baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
// });

// export const generateArticle = async (req, res) => {
//   try {
//     const { userId } = req.auth();
//     const { prompt, length } = req.body;


//     const plan = req.plan;
//     const free_usage = req.free_usage;


//     if (plan !== 'premium' && free_usage >= 10) {
//       return res.json({ success: false, message: "Limit reached. Upgrade to continue." })
//     }

//     const response = await AI.chat.completions.create({
//         model: "gemini-2.5-flash",
//         messages: [
//             {
//                 role: "user",
//                 content: prompt,
//             },

//         ],
//         temperature: 0.7,
//         max_tokens: length,
//     });

//     const content = response.choices[0].message.content

//     console.log(content);

//     if(content===undefined){
//       return res.json({ success: false, message: "content is undefined" })
//     }

//     await sql` INSERT INTO creations (user_id,prompt,content,type) VALUES (${userId},${prompt},${content},'article')`;

//     if (plan !== 'premium') {
//       await clerkClient.users.updateUserMetadata(userId, {
//         privateMetadata: {
//           free_usage: free_usage + 1
//         }
//       })
//     }


//     res.json({ success: true, content })

//   } catch (error) {
//     console.log(error.message);
//     if (error.response?.status === 429) {
//       return res.status(429).json({ message: "AI quota limit reached for today." });
//     }

//     res.json({ success: false, message: error.message })
//   }
// }



export const generateArticle = async (req, res) => {
  try {
    const { prompt, length } = req.body;
    const plan= req.plan;
    const free_usage = req.free_usage;

    const safeLength = length ? Math.max(length, 4000) : 4000;

    if (!process.env.GEMINI_API_KEY) throw new Error("API Key Missing");

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        maxOutputTokens: safeLength,
        temperature: 0.7,
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
        ]
      }
    });

    // 2. Handle the response
    const content = response.text;

    if (!content) {
      const candidate = response.candidates?.[0];
      if (candidate?.finishReason === "MAX_TOKENS") {
        return res.status(400).json({
          success: false,
          message: "The article was too long for the current limit. Please try a shorter length or simpler topic."
        });
      }
      return res.status(400).json({ success: false, message: "AI blocked this request. Try a different prompt." });
    }

    await sql`INSERT INTO creations (user_id, prompt, content, type) VALUES (${req.auth().userId}, ${prompt}, ${content}, 'article')`;
    if (plan !== 'premium') {
      await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: {
          free_usage: free_usage + 1
        }
      })
    }
    res.json({ success: true, content });

  } catch (error) {
    console.error("🔴 GenAI Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
}

export const generateBlogTitle = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt } = req.body;
    
    // Existing Plan Logic
    const plan = req.plan || 'free';
    const free_usage = req.free_usage || 0;

    if (plan !== 'premium' && free_usage >= 10) {
      return res.json({ success: false, message: "Limit reached. Upgrade to continue." })
    }

    if (!process.env.GEMINI_API_KEY) throw new Error("API Key Missing");

    // 1. Initialize SDK
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // 2. Generate Content
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [{ text: `Generate 5 catchy, SEO-friendly blog titles for this topic: ${prompt}. Return only the titles.` }] 
        }
      ],
      config: {
        // 👇 FIX 1: Increase tokens (200 is too low for a list)
        maxOutputTokens: 1000, 
        temperature: 0.7,
        // 👇 FIX 2: Add Safety Settings (Crucial for Gemini 2.5)
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
        ]
      }
    });

    // 3. Get Text safely
    const content = response.text;

    if (!content) {
        console.warn("⚠️ AI Blocked Blog Title Request");
        return res.status(400).json({ success: false, message: "AI blocked this request. Try a different prompt." });
    }

    // 4. Save to DB
    await sql`INSERT INTO creations (user_id, prompt, content, type) VALUES (${userId}, ${prompt}, ${content}, 'blog-title')`;

    // 5. Update Usage
    if (plan !== 'premium') {
      await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: {
          free_usage: free_usage + 1
        }
      })
    }

    res.json({ success: true, content });

  } catch (error) {
    console.error("🔴 Blog Title Error:", error);
    res.status(500).json({ success: false, message: error.message || "Internal Server Error" })
  }
}

export const generateImage = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt, publish } = req.body;
    const plan = req.plan;


    if (plan !== 'premium') {
      return res.json({ success: false, message: "Only Available for premium customers." })
    }




    const formData = new FormData();
    formData.append('prompt', prompt)


    const { data } = await axios.post("https://clipdrop-api.co/text-to-image/v1", formData, {
      headers: {
        'x-api-key': process.env.CLIPDROP_API_KEY,
      },
      responseType: "arraybuffer",
    })



    const base64Image = `data:image/png;base64,${Buffer.from(data, 'binary').toString('base64')}`;


    const { secure_url } = await cloudinary.uploader.upload(base64Image);




    await sql` INSERT INTO creations (user_id,prompt,content,type,publish) VALUES (${userId},${prompt},${secure_url},'image',${publish ?? false})`;



    res.json({ success: true, content: secure_url })

  } catch (error) {
    console.log(error.message);
    if (error.response?.status === 429) {
      return res.status(429).json({ message: "AI quota limit reached for today." });
    }

    res.json({ success: false, message: error.message })
  }
}


export const removeImageBackground = async (req, res) => {
  try {
    const { userId } = req.auth();
    const plan = req.plan;
    const image = req.file


    if (plan !== 'premium') {
      return res.json({ success: false, message: "Only Available for premium customers." })
    }



    const { secure_url } = await cloudinary.uploader.upload(image.path, {
      transformation: [
        {
          effect: 'background_removal',
          background_removal: 'remove_the_background'
        }
      ]
    });




    await sql` INSERT INTO creations (user_id,prompt,content,type) VALUES (${userId},'remove background from image',${secure_url},'image')`;



    res.json({ success: true, content: secure_url })

  } catch (error) {
    console.log(error.message);
    if (error.response?.status === 429) {
      return res.status(429).json({ message: "AI quota limit reached for today." });
    }

    res.json({ success: false, message: error.message })
  }
}


export const removeImageObject = async (req, res) => {
  try {
    const { userId } = req.auth();
    const plan = req.plan;
    const image = req.file
    const { object } = req.body;


    if (plan !== 'premium') {
      return res.json({ success: false, message: "Only Available for premium customers." })
    }



    const { public_id } = await cloudinary.uploader.upload(image.path);


    const imageUrl = cloudinary.url(public_id, {
      transformation: [{ effect: `gen_remove:${object}` }],
      resource_type: 'image'
    })


    await sql` INSERT INTO creations (user_id,prompt,content,type) VALUES (${userId},${`Removed ${object} from image`},${imageUrl},'image')`;



    res.json({ success: true, content: imageUrl })

  } catch (error) {
    console.log(error.message);
    if (error.response?.status === 429) {
      return res.status(429).json({ message: "AI quota limit reached for today." });
    }

    res.json({ success: false, message: error.message })
  }
}


export const resumeReview = async (req, res) => {
  try {
    const { userId } = req.auth();
    // 1. Get Plan (From your middleware)
    const plan = req.plan || 'free';
    const resume = req.file;

    // 2. Validation Checks
    if (plan !== 'premium') {
      return res.json({ success: false, message: "This feature is only available for premium customers." });
    }

    if (!resume) {
      return res.status(400).json({ success: false, message: "No resume file uploaded." });
    }

    if (resume.size > 5 * 1024 * 1024) {
      return res.json({ success: false, message: "Resume file size exceeds allowed size (5 MB)." });
    }

    // 3. Parse the PDF
    const dataBuffer = fs.readFileSync(resume.path);
    const pdfData = await pdf(dataBuffer);
    
    // Check if PDF text was actually extracted
    if (!pdfData || !pdfData.text) {
        return res.status(400).json({ success: false, message: "Could not read text from this PDF. Please try a text-based PDF." });
    }

    const prompt = `Review the following resume and provide constructive feedback on its strengths, weaknesses, and areas for improvement. Format the output clearly. \n\nResume Content:\n${pdfData.text}`;

    if (!process.env.GEMINI_API_KEY) throw new Error("API Key Missing");

    // 4. Initialize AI (New SDK)
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // 5. Generate Review
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        // 👇 Increased to 4000 because reviews are long/detailed
        maxOutputTokens: 4000, 
        temperature: 0.7,
        // 👇 Safety Settings (Critical for resumes which contain personal info)
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
        ]
      }
    });

    // 6. Get Content
    const content = response.text;

    if (!content) {
        return res.status(400).json({ success: false, message: "AI blocked this request. Try a different format." });
    }

    // 7. Save to DB
    // Note: We don't save the whole PDF text to DB to save space, just the AI's review.
    await sql`INSERT INTO creations (user_id, prompt, content, type) 
              VALUES (${userId}, 'Review the uploaded resume', ${content}, 'resume-review')`;

    // (Optional) Delete the file from 'uploads/' after processing to save server space
    // fs.unlinkSync(resume.path); 

    res.json({ success: true, content });

  } catch (error) {
    console.error("🔴 Resume Review Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
}





export const chata = async (req, res) => {
  try {
    const userMessage = req.body.message;

    const response = await axios.post(
      'https://api.cohere.ai/v1/chat',
      {
        message: userMessage,
        chat_history: [],
        model: 'command-r-plus-08-2024',
        temperature: 0.5,
        stream: false
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.COHERE_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const botReply = response.data.text || response.data.reply;
    return res.status(200).json({ reply: botReply });
  } catch (err) {
    console.error('Cohere error:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Something went wrong with AI.' });
  }
};




export const saveMessages = async (req, res) => {
  try {
    const { title, messages } = req.body;
    const { userId } = req.auth;

    if (!title || !messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid data provided' });
    }

    // 1. Create a new chat entry
    const chatInsertResult = await sql`
      INSERT INTO chats (user_id, title)
      VALUES (${userId}, ${title})
      RETURNING id
    `;
    const chatId = chatInsertResult[0].id;

    // 2. Insert messages in the correct order (sequentially)
    for (const msg of messages) {
      await sql`
        INSERT INTO messages (chat_id, role, content, created_at)
        VALUES (${chatId}, ${msg.role}, ${msg.content}, NOW())
      `;
    }

    res.status(201).json({ message: 'Chat saved successfully', chatId });
  } catch (err) {
    console.error('❌ Error saving messages:', err);
    res.status(500).json({ error: 'Failed to save chat' });
  }
};


export const getUserChats = async (req, res) => {
  const { userId } = req.auth();
  try {
    const result = await sql`
      SELECT id,user_id,title, created_at FROM chats
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `;
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
};




export const getSingleChat = async (req, res) => {
  const { userId } = req.auth(); // Make sure you're using Clerk's latest `req.auth()` function
  const chatId = req.params.id;

  try {
    // Fetch messages from the messages table where chat_id matches
    const messages = await sql`
      SELECT id, chat_id, role, content, created_at
      FROM messages
      WHERE chat_id = ${chatId}
      ORDER BY created_at ASC
    `;

    if (messages.rowCount === 0) {
      return res.status(404).json({ error: 'No messages found for this chat' });
    }

    res.status(200).json(messages);
  } catch (error) {
    console.error('❌ Backend Error in getSingleChat:', error);
    res.status(500).json({ error: 'Failed to load chat messages' });
  }
};




export const Dele = async (req, res) => {
  const { id } = req.body;
  const { userId } = req.auth;

  try {
    const resp = await sql`
      DELETE FROM chats
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id
    `;

    if (resp.length > 0) {
      return res.status(200).json({ success: true, message: 'Deleted Successfully' });
    } else {
      return res.status(404).json({ success: false, message: 'Item not found or unauthorized' });
    }
  } catch (error) {
    console.error('❌ Delete error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};