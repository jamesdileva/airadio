#!/usr/bin/env python3
"""
Elm Wave Network- TTS Engine
Reads a script file and outputs a .wav audio file using Kokoro TTS.

Usage:
  python tts.py --input script.txt --output audio.wav --voice af_heart
"""

import argparse
import sys
import os

def main():
    parser = argparse.ArgumentParser(description='Kokoro TTS Engine')
    parser.add_argument('--input',  required=True, help='Path to script text file')
    parser.add_argument('--output', required=True, help='Path for output .wav file')
    parser.add_argument('--voice',  default='af_heart', help='Voice to use')
    parser.add_argument('--speed',  type=float, default=1.0, help='Speech speed')
    args = parser.parse_args()

    # Validate input file
    if not os.path.exists(args.input):
        print(f'ERROR: Input file not found: {args.input}', file=sys.stderr)
        sys.exit(1)

    # Read script
    with open(args.input, 'r', encoding='utf-8') as f:
        text = f.read().strip()

    if not text:
        print('ERROR: Script file is empty', file=sys.stderr)
        sys.exit(1)

    print(f'Generating TTS for {len(text)} characters...')
    print(f'Voice: {args.voice} | Speed: {args.speed}')

    try:
        from kokoro_onnx import Kokoro
        import soundfile as sf

        kokoro = Kokoro('kokoro-v1.0.onnx', 'voices-v1.0.bin')
        samples, sample_rate = kokoro.create(
            text,
            voice=args.voice,
            speed=args.speed,
            lang='en-us'
        )

        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        sf.write(args.output, samples, sample_rate)
        print(f'SUCCESS: Audio saved to {args.output}')
        print(f'DURATION: {len(samples) / sample_rate:.1f}')

    except ImportError as e:
        print(f'ERROR: Missing dependency: {e}', file=sys.stderr)
        print('Run: pip install kokoro-onnx soundfile', file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f'ERROR: TTS generation failed: {e}', file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()