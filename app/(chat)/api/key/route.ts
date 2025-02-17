import { NextResponse } from 'next/server';

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

export async function GET() {
  try {
    // In this simple example, we directly return the AssemblyAI API key.
    // In production you might generate a temporary token instead.
    const assemblyaiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!assemblyaiKey) {
      throw new Error('ASSEMBLYAI_API_KEY is not set.');
    }
    return NextResponse.json({ key: assemblyaiKey });
  } catch (err: any) {
    console.error('Error generating AssemblyAI key:', err);
    return NextResponse.json(
      { error: err.message || 'Error generating key' },
      { status: 500 }
    );
  }
}
