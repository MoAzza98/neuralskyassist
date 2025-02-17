// /app/api/key/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@deepgram/sdk';
import dotenv from 'dotenv';

dotenv.config();

const client = createClient(process.env.DEEPGRAM_API_KEY);

export async function GET() {
  try {
    // Get your Deepgram projects
    const { result, error } = await client.manage.getProjects();
    if (error) {
      throw new Error(error.message);
    }
    const projectId = result.projects[0].project_id;

    // Create a temporary key with a short time to live (e.g., 20 seconds)
    const keyResponse = await client.manage.createProjectKey(projectId, {
      comment: 'short lived',
      scopes: ['usage:write'],
      time_to_live_in_seconds: 20,
    });
    if (keyResponse.error) {
      throw new Error(keyResponse.error.message);
    }

    return NextResponse.json(keyResponse.result);
  } catch (err: any) {
    console.error('Error generating Deepgram key:', err);
    return NextResponse.json({ error: err.message || 'Error generating key' }, { status: 500 });
  }
}
