// /app/api/key/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@deepgram/sdk';
import dotenv from 'dotenv';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const deepgramKey = process.env.DEEPGRAM_API_KEY;
if (!deepgramKey) {
  console.error('DEEPGRAM_API_KEY not set.');
}

const client = createClient(deepgramKey);

export async function GET() {
  try {
    // Get your Deepgram projects
    const { result, error } = await client.manage.getProjects();
    if (error) {
      throw new Error(error.message);
    }
    if (!result.projects || result.projects.length === 0) {
      throw new Error('No projects found');
    }
    const projectId = result.projects[0].project_id;
    console.log('Project ID:', projectId);

    // Create a temporary key with a short time to live (e.g., 20 seconds)
    const keyResponse = await client.manage.createProjectKey(projectId, {
      comment: 'short lived',
      scopes: ['usage:write'],
      time_to_live_in_seconds: 20,
    });
    if (keyResponse.error) {
      throw new Error(keyResponse.error.message);
    }
    console.log('Temporary key generated:', keyResponse.result);

    // Return an object with a "key" property for the client to use
    return NextResponse.json({ key: keyResponse.result.key });
  } catch (err: any) {
    console.error('Error generating Deepgram key:', err);
    return NextResponse.json({ error: err.message || 'Error generating key' }, { status: 500 });
  }
}
