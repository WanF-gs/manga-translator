"""Dictionary lookup service for vocabulary extraction.
Uses Jisho API (free, no key required) for Japanese word lookup.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional, Dict, List
import httpx

logger = logging.getLogger(__name__)


async def lookup_japanese_word(word: str) -> Optional[Dict]:
    """Lookup a Japanese word using Jisho API.
    
    Returns:
        {
            "word": str,
            "reading": str,  # hiragana/katakana reading
            "definitions": [str],  # English definitions
            "part_of_speech": str,
        }
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://jisho.org/api/v1/search/words",
                params={"keyword": word}
            )
            resp.raise_for_status()
            data = resp.json()
            
            if not data.get("data"):
                return None
            
            first = data["data"][0]
            
            # Get Japanese form (word + reading)
            japanese = first.get("japanese", [{}])[0]
            word_form = japanese.get("word", word)
            reading = japanese.get("reading", "")
            
            # Get definitions (English)
            senses = first.get("senses", [])
            definitions = []
            for sense in senses[:2]:  # top 2 definitions
                defs = sense.get("english_definitions", [])
                if defs:
                    definitions.append("; ".join(defs[:3]))
            
            # Get part of speech
            pos = ""
            if senses:
                pos_list = senses[0].get("parts_of_speech", [])
                pos = ", ".join(pos_list[:2]) if pos_list else ""
            
            return {
                "word": word_form,
                "reading": reading,
                "definitions": definitions,
                "part_of_speech": pos,
            }
    except Exception as e:
        logger.debug(f"Jisho lookup failed for '{word}': {e}")
        return None


async def batch_lookup_japanese(words: List[str], max_concurrent: int = 10) -> Dict[str, Optional[Dict]]:
    """Batch lookup multiple Japanese words with concurrency control."""
    semaphore = asyncio.Semaphore(max_concurrent)
    
    async def _lookup(w: str):
        async with semaphore:
            return w, await lookup_japanese_word(w)
    
    results = await asyncio.gather(*[_lookup(w) for w in words])
    return {w: r for w, r in results}
