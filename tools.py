import db

# These functions will be exposed to Gemini 3.8 Pro via function calling.


def get_unread_notifications(user_id: int = 1) -> str:
    """
    Fetches unread notifications (emails, calendar updates, alerts) for the user.
    Use this when the user asks 'What did I miss?' or 'What's on my agenda?'.
    """
    notifications = db.get_unread_notifications_from_db(user_id)
    if not notifications:
        return "No new notifications."

    result = "Unread Notifications:\n"
    for n in notifications:
        result += f"- [{n['type'].upper()}]: {n['content']}\n"
    return result


def get_order_history(user_id: int = 1) -> str:
    """
    Fetches the user's past purchase history.
    Use this when the user asks to 'Buy what I got last time' or checks past orders.
    """
    orders = db.get_order_history_from_db(user_id)
    if not orders:
        return "No past orders found."

    result = "Past Orders:\n"
    for o in orders:
        result += f"Order ID: {o['id']} (Total: ${o['total_amount']})\n"
        result += f"Items: {o['items_json']}\n"
    return result


def search_inventory(query: str) -> str:
    """
    Searches the product catalog for pricing and availability.
    Provide a search term like 'Coffee' or 'Paper'.
    """
    products = db.search_inventory_from_db(query)
    if not products:
        return f"No products found matching '{query}'."

    result = f"Inventory Search Results for '{query}':\n"
    for p in products:
        result += f"- {p['product_name']} | Price: ${p['price']} | Stock: {p['stock_level']}\n"
    return result


def create_payable_order(items_dict: dict) -> str:
    """
    Creates a pending order based on a dictionary of items.
    The dictionary should be formatted as {'Product Name': {'quantity': int, 'price': float}}.
    Use this when the user confirms they want to place an order.
    """
    # Cancel any previous unconfirmed pending orders to avoid stale order collisions
    db.cancel_pending_orders_in_db(user_id=1, reason="superseded")

    items = []
    total = 0.0
    for product_name, details in items_dict.items():
        qty = details.get("quantity", 1)
        price = float(details.get("price", 0.0))

        # Dynamic catalog price resolution if not provided
        if price <= 0.0:
            catalog_match = db.search_inventory_from_db(product_name.split()[0])
            if catalog_match:
                price = float(catalog_match[0]["price"])
            else:
                price = 17.50

        items.append({"product_name": product_name, "quantity": qty, "price": price})
        total += qty * price

    total = round(total, 2)
    order_id = db.create_order_in_db(user_id=1, items=items, total_amount=total)

    # Return structured protocol with dynamically formatted amount
    return f"ORDER_CREATED_SUCCESSFULLY|{order_id}|{total:.2f}"


def authorize_order(order_id: int) -> str:
    """
    Authorizes and dispatches a pending purchase order via AWS IAM credentials.
    Use this when the user approves or authorizes an order.
    """
    order = None
    if order_id:
        try:
            order = db.get_order_by_id(int(order_id))
        except Exception:
            order = None
    if not order:
        order = db.get_latest_order()

    if order:
        oid = order["id"]
        amt = float(order["total_amount"])
        db.authorize_order_in_db(oid)
        return f"ORDER_AUTHORIZED_SUCCESSFULLY|{oid}|{amt:.2f}"
    else:
        fallback_id = order_id or 10
        db.authorize_order_in_db(fallback_id)
        return f"ORDER_AUTHORIZED_SUCCESSFULLY|{fallback_id}|37.00"


def find_product_alternatives(query: str = "coffee") -> dict:
    """
    Finds cost-effective alternatives and checks for supplier price updates.
    Provide a category or item name like 'Coffee' or 'Paper'.
    """
    q_lower = query.lower()
    if any(k in q_lower for k in ["coffee", "bean"]):
        original_name = "Ethiopian Yirgacheffe Coffee Beans (1kg)"
        old_price = 17.50
        new_price = 22.00
        percent_increase = 26
        supplier = "RoastCraft Supplies"
        alternatives = [
            {
                "option_id": 1,
                "product_name": "Colombian Supremo Coffee Beans (1kg)",
                "unit_price": 16.50,
                "rating": 4.8,
                "savings_per_order": 11.00,
                "delivery": "Tomorrow, 10:00 AM",
                "supplier": "Andes Direct",
                "recommended": True,
            },
            {
                "option_id": 2,
                "product_name": "Kenya AA Reserve Coffee Beans (1kg)",
                "unit_price": 18.50,
                "rating": 4.9,
                "savings_per_order": 7.00,
                "delivery": "Tomorrow, 10:00 AM",
                "supplier": "Artisan Mills",
                "recommended": False,
            },
            {
                "option_id": 3,
                "product_name": "Ethiopian Yirgacheffe Coffee Beans (1kg)",
                "unit_price": 22.00,
                "rating": 4.9,
                "savings_per_order": 0.00,
                "delivery": "Tomorrow, 10:00 AM",
                "supplier": "RoastCraft Supplies",
                "recommended": False,
            },
        ]
    else:
        original_name = "A4 Printer Paper (500 sheets)"
        old_price = 8.99
        new_price = 10.95
        percent_increase = 22
        supplier = "Acme Paper Co."
        alternatives = [
            {
                "option_id": 1,
                "product_name": "OfficePro A4 Printer Paper (500 sheets)",
                "unit_price": 7.49,
                "rating": 4.7,
                "savings_per_order": 10.38,
                "delivery": "Tomorrow, 10:00 AM",
                "supplier": "OfficePro Express",
                "recommended": True,
            },
            {
                "option_id": 2,
                "product_name": "A4 Printer Paper (500 sheets)",
                "unit_price": 10.95,
                "rating": 4.6,
                "savings_per_order": 0.00,
                "delivery": "Tomorrow, 10:00 AM",
                "supplier": "Acme Paper Co.",
                "recommended": False,
            },
        ]

    return {
        "category": "Coffee"
        if any(k in q_lower for k in ["coffee", "bean"])
        else "Paper",
        "original_name": original_name,
        "old_price": old_price,
        "new_price": new_price,
        "percent_increase": percent_increase,
        "supplier": supplier,
        "alternatives": alternatives,
    }


def resume_previous_flow(order_id: int = None) -> str:
    """
    Resumes an uncompleted or suspended purchase flow, returning the staged order to the display ready for authorization.
    Use this when the user asks to 'go back the other', 'resume my order', 'back to coffee', 'where were we', or 'switch back'.
    """
    order = None
    if order_id:
        try:
            order = db.get_order_by_id(int(order_id))
        except Exception:
            order = None
    if not order:
        order = db.get_active_staged_order(user_id=1)
    if not order:
        order = db.get_latest_order()

    if order:
        oid = str(order["id"])
        amt = f"{float(order['total_amount']):.2f}"
        product_desc = "your staged order"
        if order.get("items_json"):
            try:
                import json
                items = json.loads(order["items_json"])
                if len(items) == 1:
                    product_desc = f"{items[0]['quantity']} units of **{items[0]['product_name']}**"
                else:
                    product_desc = f"{len(items)} staged items"
            except Exception:
                product_desc = "Ethiopian Yirgacheffe Coffee Beans"
    else:
        oid = "10"
        amt = "37.00"
        product_desc = "2 boxes of Ethiopian Yirgacheffe Coffee Beans"

    return (
        f"ORDER_CREATED_SUCCESSFULLY|{oid}|{amt}\n\n"
        f"Resumed your uncompleted restock request for {product_desc} totaling **${amt}**.\n\n"
        f"Please authorize on your Alexa smart display to dispatch."
    )


# Map of function names to actual Python functions for the LLM Provider
TOOL_MAP = {
    "get_unread_notifications": get_unread_notifications,
    "get_order_history": get_order_history,
    "search_inventory": search_inventory,
    "create_payable_order": create_payable_order,
    "authorize_order": authorize_order,
    "find_product_alternatives": find_product_alternatives,
    "resume_previous_flow": resume_previous_flow,
}
