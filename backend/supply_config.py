# Metal Supply Configuration
# =========================
# Above-ground supply estimates for precious metals.
# These values are used to calculate market cap: price × supply
#
# Data is loaded from data/commodities_supply.json
# Update that JSON file when supply estimates change.

import json
import os
from pathlib import Path

# Path to the supply data JSON file
DATA_DIR = Path(__file__).parent / 'data'
SUPPLY_FILE = DATA_DIR / 'commodities_supply.json'

# Load supply data from JSON file
def _load_supply_data() -> dict:
    """Load commodity supply data from JSON file."""
    try:
        with open(SUPPLY_FILE, 'r') as f:
            data = json.load(f)
            # Filter out metadata keys (starting with _)
            return {k: v for k, v in data.items() if not k.startswith('_')}
    except FileNotFoundError:
        print(f"Warning: Supply data file not found at {SUPPLY_FILE}")
        return {}
    except json.JSONDecodeError as e:
        print(f"Error parsing supply data JSON: {e}")
        return {}

# Load data once at module import
METAL_SUPPLY = _load_supply_data()


def get_supply(symbol: str) -> int:
    """Get the above-ground supply for a metal by its symbol."""
    if symbol in METAL_SUPPLY:
        return METAL_SUPPLY[symbol].get('supply', 0)
    return 0


def get_supply_info(symbol: str) -> dict:
    """Get full supply info including source and notes."""
    return METAL_SUPPLY.get(symbol, {})


def get_supply_unit(symbol: str) -> str:
    """Get the unit of measurement for a metal's supply."""
    if symbol in METAL_SUPPLY:
        return METAL_SUPPLY[symbol].get('unit', 'troy_ounces')
    return 'troy_ounces'
