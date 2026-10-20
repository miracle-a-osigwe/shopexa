import sqlite3
import json
import os

DB_NAME = "shopexa.db"

def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    # Table: Users
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            name TEXT,
            email TEXT
        )
    ''')

    # Table: Notifications (Simulates "What did I miss?")
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY,
            user_id INTEGER,
            type TEXT, -- e.g., 'email', 'calendar', 'alert'
            content TEXT,
            is_read BOOLEAN DEFAULT 0,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Table: Inventory (Simulates Shopira backend)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS inventory (
            id INTEGER PRIMARY KEY,
            product_name TEXT,
            price REAL,
            stock_level INTEGER
        )
    ''')

    # Table: Orders
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY,
            user_id INTEGER,
            total_amount REAL,
            items_json TEXT, -- JSON array of items
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    conn.commit()
    seed_db(conn)
    conn.close()

def seed_db(conn):
    cursor = conn.cursor()
    # Check if empty
    cursor.execute('SELECT COUNT(*) FROM users')
    if cursor.fetchone()[0] == 0:
        # Seed User
        cursor.execute('INSERT INTO users (name, email) VALUES (?, ?)', ('Alex Manager', 'alex@company.com'))
        
        # Seed Notifications
        cursor.executemany('''
            INSERT INTO notifications (user_id, type, content, is_read)
            VALUES (?, ?, ?, ?)
        ''', [
            (1, 'email', 'Urgent: Client needs the Q3 proposal reviewed by tomorrow noon.', 0),
            (1, 'calendar', 'Your 3 PM meeting with Acme Corp was moved to 4 PM today.', 0),
            (1, 'alert', 'Inventory Alert: The office breakroom is out of Ethiopian Yirgacheffe Coffee Beans and Printer Paper.', 0)
        ])

        # Seed Inventory
        cursor.executemany('''
            INSERT INTO inventory (product_name, price, stock_level)
            VALUES (?, ?, ?)
        ''', [
            ('Ethiopian Yirgacheffe Coffee Beans (1kg)', 17.50, 50),
            ('Colombian Supremo Coffee Beans (1kg)', 16.50, 75),
            ('Kenya AA Reserve Coffee Beans (1kg)', 18.50, 40),
            ('A4 Printer Paper (500 sheets)', 8.99, 120),
            ('OfficePro A4 Printer Paper (500 sheets)', 7.49, 150),
            ('Whiteboard Markers (Pack of 4)', 4.50, 15)
        ])
        
        # Seed Past Order (To test "Buy it again")
        past_items = json.dumps([
            {"product_id": 1, "product_name": "Ethiopian Yirgacheffe Coffee Beans (1kg)", "quantity": 1, "price": 17.50},
            {"product_id": 4, "product_name": "A4 Printer Paper (500 sheets)", "quantity": 2, "price": 8.99}
        ])
        cursor.execute('''
            INSERT INTO orders (user_id, total_amount, items_json, status)
            VALUES (?, ?, ?, ?)
        ''', (1, 35.48, past_items, 'completed'))

        conn.commit()

    # Ensure alternative and consumable items exist if DB was already seeded previously
    cursor.execute('SELECT COUNT(*) FROM inventory WHERE product_name LIKE ?', ('%Colombian%',))
    if cursor.fetchone()[0] == 0:
        cursor.executemany('''
            INSERT INTO inventory (product_name, price, stock_level)
            VALUES (?, ?, ?)
        ''', [
            ('Colombian Supremo Coffee Beans (1kg)', 16.50, 75),
            ('Kenya AA Reserve Coffee Beans (1kg)', 18.50, 40),
            ('OfficePro A4 Printer Paper (500 sheets)', 7.49, 150)
        ])
        conn.commit()

    cursor.execute('SELECT COUNT(*) FROM inventory WHERE product_name LIKE ?', ('%Microfiber%',))
    if cursor.fetchone()[0] == 0:
        cursor.executemany('''
            INSERT INTO inventory (product_name, price, stock_level)
            VALUES (?, ?, ?)
        ''', [
            ('Microfiber Cleaning Cloths (Pack of 12)', 16.99, 45),
            ('Gel Ink Pens (Box of 12)', 5.95, 60),
            ('60W USB-C Braided Cables (5-Pack)', 27.99, 30),
            ('High Yield Black Toner', 90.00, 25),
            ('Commercial Hand Sanitizer Refill (4 Gallons)', 20.00, 40),
            ('High-Density Anti-Fatigue Desk Mats (Set of 2)', 49.99, 20)
        ])
        # Add past facility purchase from 3 weeks ago
        past_facility_items = json.dumps([
            {"product_id": 1, "product_name": "Ethiopian Yirgacheffe Coffee Beans (1kg)", "quantity": 2, "price": 18.50},
            {"product_id": 7, "product_name": "Microfiber Cleaning Cloths (Pack of 12)", "quantity": 1, "price": 16.99}
        ])
        cursor.execute('''
            INSERT INTO orders (user_id, total_amount, items_json, status)
            VALUES (?, ?, ?, ?)
        ''', (1, 53.99, past_facility_items, 'completed'))
        conn.commit()

    cursor.execute('SELECT COUNT(*) FROM inventory WHERE product_name LIKE ?', ('%USB-C%',))
    if cursor.fetchone()[0] == 0:
        cursor.executemany('''
            INSERT INTO inventory (product_name, price, stock_level)
            VALUES (?, ?, ?)
        ''', [
            ('60W USB-C Braided Cables (5-Pack)', 27.99, 30),
            ('High Yield Black Toner', 90.00, 25),
            ('Commercial Hand Sanitizer Refill (4 Gallons)', 20.00, 40),
            ('High-Density Anti-Fatigue Desk Mats (Set of 2)', 49.99, 20)
        ])
        conn.commit()

# Helper functions for the AI tools
def get_unread_notifications_from_db(user_id=1):
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM notifications WHERE user_id = ? AND is_read = 0', (user_id,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def get_order_history_from_db(user_id=1):
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM orders WHERE user_id = ? AND status = "completed" ORDER BY created_at DESC LIMIT 5', (user_id,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def search_inventory_from_db(query: str):
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM inventory WHERE product_name LIKE ?', (f'%{query}%',))
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def create_order_in_db(user_id=1, items=None, total_amount=0.0):
    if items is None:
        items = []
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    items_json = json.dumps(items)
    cursor.execute('''
        INSERT INTO orders (user_id, total_amount, items_json, status)
        VALUES (?, ?, ?, 'pending_confirmation')
    ''', (user_id, total_amount, items_json))
    order_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return order_id

def authorize_order_in_db(order_id: int):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("UPDATE orders SET status = 'authorized' WHERE id = ?", (order_id,))
    conn.commit()
    conn.close()
    return True

def get_order_by_id(order_id: int):
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM orders WHERE id = ?', (order_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def cancel_pending_orders_in_db(user_id=1, reason="superseded"):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("UPDATE orders SET status = ? WHERE user_id = ? AND status = 'pending_confirmation'", (f"canceled_{reason}", user_id))
    canceled_count = cursor.rowcount
    conn.commit()
    conn.close()
    return canceled_count

def cancel_order_by_id(order_id: int):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("UPDATE orders SET status = 'canceled' WHERE id = ?", (order_id,))
    conn.commit()
    conn.close()
    return True

def get_active_staged_order(user_id=1):
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM orders WHERE user_id = ? AND status = 'pending_confirmation' ORDER BY id DESC LIMIT 1", (user_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_latest_order():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM orders ORDER BY id DESC LIMIT 1')
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_product_alternatives_from_db(query: str):
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM inventory WHERE product_name LIKE ? ORDER BY price ASC', (f'%{query}%',))
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

if __name__ == "__main__":
    init_db()
    print("Database initialized and seeded.")
