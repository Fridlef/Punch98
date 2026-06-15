# Punch98

Punch98 is a small retro-style desktop utility for tracking and logging work time.

The app is built with Electron and uses a Windows 98-inspired interface style.

## Features

- Track work time
- Add notes / entries
- Tray icon support
- Visual status indication
- Portable Windows EXE build
- Retro 98-style UI

## Requirements

For running from source:

- Node.js
- npm

Install dependencies:

    npm install

Run in development:

    npm start

or:

    npm run dev

## Build portable EXE

    npm run dist

The portable executable will be created in:

    dist\Punch98-portable-0.1.0.exe

## Local files

The app may create local runtime files such as logs or local user data.

These files should not be committed to Git.

## Development note

This is an AI-assisted / vibe-coded project.

The app was created as a practical utility for a real workflow.  
Most of the code was generated and iteratively refined with the help of AI tools, while the requirements, testing, debugging, UI decisions, and final behavior were guided manually.

The goal of this project is usefulness and portability, not perfect code architecture.
