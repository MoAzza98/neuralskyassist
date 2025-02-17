import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { promises as fsPromises } from 'fs'
import { v4 as uuid } from 'uuid'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// Create a local temp folder if it doesn't exist
const tempDir = path.join(process.cwd(), 'temp')
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir)
}

export async function POST(request: NextRequest) {
  try {
    // 1) Parse the formData from Next.js
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

    // 2) Write the file to the local temp dir
    const buffer = Buffer.from(await file.arrayBuffer())
    const tempFilename = `temp-${uuid()}.${extension}`
    const tempFilePath = path.join(tempDir, tempFilename)
    await fsPromises.writeFile(tempFilePath, buffer)

    // 3) Call Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-1',
      response_format: 'text'
    })

    // 4) Clean up the temporary file
    await fsPromises.unlink(tempFilePath)

    return NextResponse.json({
      text: transcription
    })
  } catch (err: any) {
    console.error('Error transcribing audio:', err)
    return NextResponse.json({ error: err.message || 'Failed to transcribe audio' }, { status: 500 })
  }
}
