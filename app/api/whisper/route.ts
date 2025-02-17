import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { promises as fsPromises } from 'fs'
import { v4 as uuid } from 'uuid'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// Slightly lower threshold for file size so smaller mobile recordings still work:
const MIN_AUDIO_FILE_SIZE = 1000; // bytes

// Minimal length for valid transcription text (post-cleaning).
const MIN_TRANSCRIPT_LENGTH = 5;

// Create a /tmp/temp folder if it doesn't exist (Vercel only allows writes to /tmp).
const tempDir = '/tmp/temp';
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

export async function POST(request: NextRequest) {
  try {
    // 1) Parse the FormData from Next.js
    const formData = await request.formData()
    const file = formData.get('audio') as File

    if (!file) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
    }

    // Determine the file extension based on the MIME type
    let extension = 'webm'
    if (file.type.includes('ogg')) {
      extension = 'ogg'
    } else if (file.type.includes('mp4')) {
      extension = 'mp4'
    }

    // 2) Write the file to the local temp dir, but first check size
    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.length < MIN_AUDIO_FILE_SIZE) {
      return NextResponse.json({ error: 'No meaningful audio recorded.' }, { status: 200 })
    }

    const tempFilename = `temp-${uuid()}.${extension}`
    const tempFilePath = path.join(tempDir, tempFilename)
    await fsPromises.writeFile(tempFilePath, buffer)

    // 3) Call the Whisper API
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-1',
      response_format: 'text'
    })

    // 4) Clean up the temporary file
    await fsPromises.unlink(tempFilePath)

    // Basic trimming / cleanup
    const cleaned = transcription.trim().replace(/\s+/, ' ')
    if (cleaned.length < MIN_TRANSCRIPT_LENGTH) {
      return NextResponse.json({ error: 'No meaningful speech detected.' }, { status: 200 })
    }

    return NextResponse.json({
      text: cleaned
    })
  } catch (err: any) {
    console.error('Error transcribing audio:', err)
    return NextResponse.json({ error: err.message || 'Failed to transcribe audio' }, { status: 500 })
  }
}
