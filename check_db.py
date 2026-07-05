#!/usr/bin/env python3
"""Check actual translation text content in database"""
import asyncio
import asyncpg

async def check():
    conn = await asyncpg.connect(
        "postgresql://manga_user:manga_pass@localhost:5433/manga_translator",
        timeout=5
    )
    
    # Check pages table columns first
    cols = await conn.fetch("""
        SELECT column_name FROM information_schema.columns 
        WHERE table_name='pages' ORDER BY ordinal_position
    """)
    print("=== Pages columns ===")
    print([c['column_name'] for c in cols])
    
    # Get latest page
    rows = await conn.fetch("""
        SELECT page_id, original_url, processed_url, created_at,
               (SELECT COUNT(*) FROM text_regions r WHERE r.page_id = p.page_id) as region_count
        FROM pages p
        ORDER BY p.created_at DESC
        LIMIT 3
    """)
    
    print("\n=== Latest Pages ===")
    for r in rows:
        print(f"  Page: {str(r['page_id'])[:8]}... regions={r['region_count']}")
        print(f"   original: {r['original_url']}")
        print(f"  processed: {r['processed_url']}")
    
    if not rows:
        print("No pages found!")
        return
    
    latest_page_id = rows[0]['page_id']
    
    # Get text regions with actual text
    print(f"\n=== Text Regions for latest page ({str(latest_page_id)[:8]}...) ===")
    regions = await conn.fetch("""
        SELECT region_id, type, original_text, translated_text, confidence
        FROM text_regions
        WHERE page_id = $1
        ORDER BY sort_order ASC
    """, latest_page_id)
    
    for i, r in enumerate(regions):
        orig = r['original_text'] or '(empty)'
        trans = r['translated_text'] or '(empty)'
        has_replacement = '\ufffd' in trans or '\u25cf' in trans  # ●
        print(f"\n  [{i+1}] type={r['type']} conf={r['confidence']:.2f}")
        print(f"       orig({len(orig)}ch): {orig[:100]}")
        print(f"       trans({len(trans)}ch): {trans[:100]}")
        if has_replacement:
            print(f"       *** CONTAINS ●/� REPLACEMENT CHAR ***")
            print(f"       hex: {[hex(ord(c)) for c in trans[:30]]}")
    
    await conn.close()

asyncio.run(check())
