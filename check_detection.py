"""Check latest detection results from DB"""
import asyncio, json, sys, os
sys.path.insert(0, "/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend")

async def main():
    import asyncpg
    
    conn = await asyncpg.connect(
        host="localhost", port=5433, user="manga_user",
        password="manga_pass", database="manga_translator"
    )
    
    # Find latest page with regions
    rows = await conn.fetch("""
        SELECT p.page_id, p.original_url, COUNT(r.region_id) as region_count,
               MAX(p.created_at) as page_time
        FROM pages p 
        LEFT JOIN text_regions r ON p.page_id = r.page_id
        GROUP BY p.page_id, p.original_url
        ORDER BY page_time DESC LIMIT 5
    """)

    for row in rows:
        print(f"=== Page: {str(row['page_id'])[:8]}... | Regions: {row['region_count']} ===")
        
        if row['region_count'] > 0:
            regs = await conn.fetch("""
                SELECT region_id, type, confidence, boundary, sort_order
                FROM text_regions
                WHERE page_id = $1
                ORDER BY sort_order ASC
            """, row['page_id'])
            
            for i, r in enumerate(regs[:30]):
                b = json.loads(r['boundary']) if r['boundary'] else {}
                bx = b.get('x', 0)
                by_ = b.get('y', 0)
                bw = b.get('width', 0)
                bh = b.get('height', 0)
                print(f"  [{i+1}] {r['type']:10s} conf={r['confidence']:.2f} "
                      f"bbox=({bx:>4},{by_:>4},{bw:>4},{bh:>4}) area={bw*bh:>6}")
    
            if len(rows[0]) > 30:
                print(f"  ... and {len(regs)-30} more")
    
    await conn.close()

asyncio.run(main())
