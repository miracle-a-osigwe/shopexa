try:
    # mcp official server
    from mcp.server import MCPServer
except ImportError:
    try:
        # mcp 2.x subpath
        from mcp.server.mcpserver import MCPServer
    except ImportError:
        try:
            # fastmcp package
            from fastmcp import FastMCP as MCPServer
        except ImportError:
            from mcp.server.fastmcp import FastMCP as MCPServer

import tools

# Create the MCP Server instance using the official MCP 2.x MCPServer class
mcp = MCPServer("shopexa-ops-mcp")


@mcp.tool()
def get_unread_notifications(user_id: int = 1) -> str:
    """Fetches unread notifications (emails, calendar updates, alerts) for the user."""
    return tools.get_unread_notifications(user_id)


@mcp.tool()
def get_order_history(user_id: int = 1) -> str:
    """Fetches the user's past purchase history."""
    return tools.get_order_history(user_id)


@mcp.tool()
def search_inventory(query: str) -> str:
    """Searches the product catalog for pricing and availability."""
    return tools.search_inventory(query)


@mcp.tool()
def create_payable_order(items_dict: dict) -> str:
    """Creates a pending order based on a dictionary of items."""
    return tools.create_payable_order(items_dict)


@mcp.tool()
def authorize_order(order_id: int) -> str:
    """Authorizes and dispatches a pending purchase order via AWS IAM credentials."""
    return tools.authorize_order(order_id)


@mcp.tool()
def find_product_alternatives(query: str = "coffee") -> dict:
    """Finds cost-effective alternatives and checks for supplier price updates."""
    return tools.find_product_alternatives(query)


@mcp.tool()
def resume_previous_flow(order_id: int = None) -> str:
    """Resumes an uncompleted or suspended purchase flow, returning the staged order to the display ready for authorization."""
    return tools.resume_previous_flow(order_id)


if __name__ == "__main__":
    mcp.run()
