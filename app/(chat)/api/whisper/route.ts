import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

const MIN_AUDIO_FILE_SIZE = 1000 // bytes
const MIN_TRANSCRIPT_LENGTH = 5  // characters

export async function POST(request: NextRequest) {
  try {
    // Parse form data and extract the uploaded audio file.
    const formData = await request.formData()
    const file = formData.get('audio') as File
    if (!file) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
    }

    // Determine file extension based on MIME type.
    let extension = 'webm'
    if (file.type.includes('ogg')) {
      extension = 'ogg'
    } else if (file.type.includes('mp4')) {
      extension = 'mp4'
    }

    // Check if the file is large enough.
    if (file.size < MIN_AUDIO_FILE_SIZE) {
      return NextResponse.json({ error: 'No meaningful audio recorded.' }, { status: 200 })
    }

    // Ensure the file has a proper filename.
    // If file.name is missing or empty, create one using the extension.
    const filename = file.name && file.name.trim().length > 0 ? file.name : `audio.${extension}`
    // (Optionally, you can create a new File from the arrayBuffer to enforce a name.)
    const audioFile = new File([await file.arrayBuffer()], filename, { type: file.type })

    // Call OpenAI’s Whisper API with the audio file.
    const transcriptionText = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      response_format: 'text',
      // language: 'en', // Uncomment to force a specific language.
    })

    // Clean up and validate the transcript.
    const cleaned = transcriptionText.trim().replace(/\s+/, ' ')
    if (cleaned.length < MIN_TRANSCRIPT_LENGTH) {
      return NextResponse.json({ error: 'No meaningful speech detected.' }, { status: 200 })
    }

    return NextResponse.json({ text: cleaned })
  } catch (err: any) {
    console.error('Error transcribing audio:', err)
    return NextResponse.json({ error: err.message || 'Failed to transcribe audio' }, { status: 500 })
  }
}
