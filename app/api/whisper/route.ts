import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { promises as fsPromises } from 'fs'
import { v4 as uuid } from 'uuid'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// Only /tmp is writable on Vercel.
// We'll store temp files there:
const tempDir = '/tmp/temp'
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir)
}

// For short audio detection and minimal text checks
const MIN_AUDIO_FILE_SIZE = 1000 // bytes
const MIN_TRANSCRIPT_LENGTH = 5  // characters

export async function POST(request: NextRequest) {
  try {
    // 1) Parse the formData
    const formData = await request.formData()
    const file = formData.get('audio') as File

    if (!file) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
    }

    // Determine extension from MIME
    let extension = 'webm'
    if (file.type.includes('ogg')) {
      extension = 'ogg'
    } else if (file.type.includes('mp4')) {
      extension = 'mp4'
    }

    // 2) Write the file to /tmp
    const buffer = Buffer.from(await file.arrayBuffer())

    // Check if file is large enough
    if (buffer.length < MIN_AUDIO_FILE_SIZE) {
      return NextResponse.json({ error: 'No meaningful audio recorded.' }, { status: 200 })
    }

    const tempFilename = `temp-${uuid()}.${extension}`
    const tempFilePath = path.join(tempDir, tempFilename)
    await fsPromises.writeFile(tempFilePath, buffer)

    // 3) Call OpenAI Whisper
    // Optionally specify language if you always expect e.g. English:
    const transcriptionText = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-1',
      response_format: 'text',
      // language: 'en',  // uncomment if you want to force English
    })

    // 4) Clean up temp file
    await fsPromises.unlink(tempFilePath)

    // Basic text cleanup
    const cleaned = transcriptionText.trim().replace(/\s+/, ' ')

    // If text is too short, consider it "no speech"
    if (cleaned.length < MIN_TRANSCRIPT_LENGTH) {
      return NextResponse.json({ error: 'No meaningful speech detected.' }, { status: 200 })
    }

    return NextResponse.json({
      text: cleaned
    })

  } catch (err: any) {
    console.error('Error transcribing audio:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to transcribe audio' },
      { status: 500 }
    )
  }
}
