"""
Historical Events Data

This module provides historical event data for overlaying on price charts.
Events include:
- U.S. Government Shutdowns (loaded from data/government_shutdowns.json)
- Federal Reserve Rate Decisions (dynamic from FRED API)

Data Sources:
- Government Shutdowns: Manually maintained JSON file (no reliable API exists)
  Source: https://en.wikipedia.org/wiki/Government_shutdowns_in_the_United_States
- Fed Rates: FRED API (Federal Reserve Economic Data)
  https://fred.stlouisfed.org/series/DFF
"""

import os
import json
import requests
from datetime import date, timedelta
from pathlib import Path
from typing import Optional
from logger import setup_logger

# Set up logger
logger = setup_logger('historical_events')

# FRED API configuration
FRED_API_KEY = os.environ.get('FRED_API_KEY', '')
FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations'

# Path to data files
DATA_DIR = Path(__file__).parent / 'data'

# Event categories with metadata
EVENT_CATEGORIES = {
    'government_shutdown': {
        'name': 'U.S. Government Shutdowns',
        'description': 'Federal government funding lapses that resulted in employee furloughs',
        'color': '#ff6b6b',  # Red
        'icon': '🏛️',
    },
    'fed_rate_hike': {
        'name': 'Fed Rate Hikes',
        'description': 'Federal Reserve interest rate increases',
        'color': '#f59f00',  # Orange/Yellow
        'icon': '⬆️',
    },
    'fed_rate_cut': {
        'name': 'Fed Rate Cuts',
        'description': 'Federal Reserve interest rate decreases',
        'color': '#51cf66',  # Green
        'icon': '⬇️',
    },
    'fed_rate_hold': {
        'name': 'Fed Rate Holds',
        'description': 'Federal Reserve decisions to maintain current interest rates',
        'color': '#748ffc',  # Blue
        'icon': '⏸️',
    },
}


def load_government_shutdowns() -> list:
    """
    Load government shutdown data from JSON file.
    
    The JSON file is located at data/government_shutdowns.json and should be
    updated manually when new shutdowns occur (typically very rare events).
    """
    json_path = DATA_DIR / 'government_shutdowns.json'
    try:
        with open(json_path, 'r') as f:
            data = json.load(f)
            return data.get('shutdowns', [])
    except FileNotFoundError:
        logger.warning(f"Government shutdowns data file not found at {json_path}")
        return []
    except json.JSONDecodeError as e:
        logger.error(f"Error parsing government shutdowns JSON: {e}")
        return []


def load_fomc_meetings() -> list:
    """
    Load FOMC meeting dates from JSON file.
    
    The JSON file is located at data/fomc_meetings.json and should be
    updated when new FOMC meeting dates are announced.
    """
    json_path = DATA_DIR / 'fomc_meetings.json'
    try:
        with open(json_path, 'r') as f:
            data = json.load(f)
            return data.get('meetings', [])
    except FileNotFoundError:
        logger.warning(f"FOMC meetings data file not found at {json_path}")
        return []
    except json.JSONDecodeError as e:
        logger.error(f"Error parsing FOMC meetings JSON: {e}")
        return []


def fetch_fed_rate_changes(start_date: str, end_date: str, include_holds: bool = False) -> list:
    """
    Fetch Federal Reserve rate decisions from FRED API.
    Uses the Federal Funds Effective Rate (DFF) series to detect changes.
    
    Args:
        start_date: Start date in YYYY-MM-DD format
        end_date: End date in YYYY-MM-DD format
        include_holds: If True, also return rate hold events for FOMC meetings
    
    Returns list of rate decision events (hikes, cuts, and optionally holds).
    """
    if not FRED_API_KEY:
        logger.warning("FRED_API_KEY not set. Fed rate events will not be available.")
        return []
    
    try:
        # Fetch Federal Funds Effective Rate data
        params = {
            'series_id': 'DFF',  # Federal Funds Effective Rate (Daily)
            'api_key': FRED_API_KEY,
            'file_type': 'json',
            'observation_start': start_date,
            'observation_end': end_date,
            'sort_order': 'asc',
        }
        
        response = requests.get(FRED_BASE_URL, params=params, timeout=10)
        
        if response.status_code != 200:
            logger.error(f"FRED API error: {response.status_code}")
            return []
        
        data = response.json()
        observations = data.get('observations', [])
        
        if not observations:
            return []
        
        # Build a dict of date -> rate for quick lookup
        rate_by_date = {}
        for obs in observations:
            rate_str = obs.get('value', '.')
            if rate_str != '.':  # Skip missing data
                rate_by_date[obs.get('date')] = float(rate_str)
        
        # Detect rate changes (significant changes >= 10 bps)
        rate_events = []
        prev_rate = None
        prev_date = None
        
        for obs in observations:
            rate_str = obs.get('value', '.')
            if rate_str == '.':  # Missing data
                continue
            
            current_rate = float(rate_str)
            obs_date = obs.get('date')
            
            if prev_rate is not None:
                change_bps = round((current_rate - prev_rate) * 100)  # Convert to basis points
                
                # Only record significant changes (>= 10 bps, which is 0.1%)
                if abs(change_bps) >= 10:
                    if change_bps > 0:
                        category = 'fed_rate_hike'
                        title = f'Fed Rate Hike (+{change_bps} bps)'
                        icon = '⬆️'
                    else:
                        category = 'fed_rate_cut'
                        title = f'Fed Rate Cut ({change_bps} bps)'
                        icon = '⬇️'
                    
                    rate_events.append({
                        'id': f'fed_{obs_date}_{change_bps}',
                        'category': category,
                        'start_date': obs_date,
                        'end_date': obs_date,  # Single day event
                        'title': title,
                        'description': f'Fed Funds Rate changed from {prev_rate:.2f}% to {current_rate:.2f}% ({change_bps:+d} bps)',
                        'bps_change': change_bps,
                        'rate_before': prev_rate,
                        'rate_after': current_rate,
                        'is_single_day': True,
                        'category_info': {
                            **EVENT_CATEGORIES[category],
                            'icon': icon,
                        }
                    })
            
            prev_rate = current_rate
            prev_date = obs_date
        
        # If include_holds is True, find FOMC meetings where rate didn't change
        if include_holds:
            fomc_meetings = load_fomc_meetings()
            start_dt = date.fromisoformat(start_date)
            end_dt = date.fromisoformat(end_date)
            
            # Get dates where we already have rate changes
            change_dates = {e['start_date'] for e in rate_events}
            
            for meeting_date in fomc_meetings:
                meeting_dt = date.fromisoformat(meeting_date)
                
                # Check if meeting is in our date range
                if meeting_dt < start_dt or meeting_dt > end_dt:
                    continue
                
                # Skip if we already have a rate change for this date
                if meeting_date in change_dates:
                    continue
                
                # Check if we have rate data for this date (or nearby)
                # FOMC announcements happen in afternoon, rate might show next day
                current_rate = rate_by_date.get(meeting_date)
                if current_rate is None:
                    # Try next business day
                    for i in range(1, 4):
                        next_date = (meeting_dt + timedelta(days=i)).isoformat()
                        current_rate = rate_by_date.get(next_date)
                        if current_rate is not None:
                            break
                
                if current_rate is not None:
                    rate_events.append({
                        'id': f'fed_{meeting_date}_hold',
                        'category': 'fed_rate_hold',
                        'start_date': meeting_date,
                        'end_date': meeting_date,
                        'title': 'Fed Rate Hold',
                        'description': f'Federal Reserve maintained the Fed Funds Rate at {current_rate:.2f}%',
                        'bps_change': 0,
                        'rate': current_rate,
                        'is_single_day': True,
                        'category_info': EVENT_CATEGORIES['fed_rate_hold'],
                    })
        
        # Sort by date
        rate_events.sort(key=lambda x: x['start_date'])
        
        return rate_events
        
    except requests.exceptions.Timeout:
        logger.error("FRED API request timeout")
        return []
    except Exception as e:
        logger.error(f"Error fetching FRED data: {e}")
        return []


def get_shutdown_events(start_date_str: str, end_date_str: str) -> list:
    """Get government shutdown events within a date range."""
    start_date = date.fromisoformat(start_date_str)
    end_date = date.fromisoformat(end_date_str)
    
    events = []
    shutdowns = load_government_shutdowns()
    
    for shutdown in shutdowns:
        event_start = date.fromisoformat(shutdown['start_date'])
        event_end = date.fromisoformat(shutdown['end_date'])
        
        # Check if event overlaps with the date range
        if event_start <= end_date and event_end >= start_date:
            events.append({
                'id': shutdown['id'],
                'start_date': shutdown['start_date'],
                'end_date': shutdown['end_date'],
                'title': shutdown['title'],
                'description': shutdown['description'],
                'days': shutdown.get('days', 0),
                'category': 'government_shutdown',
                'is_single_day': shutdown.get('days', 0) == 1,
                'category_info': EVENT_CATEGORIES['government_shutdown'],
            })
    
    return events


def get_events_in_range(start_date_str: str, end_date_str: str, categories: Optional[list] = None) -> list:
    """
    Get historical events that overlap with the given date range.
    
    Args:
        start_date_str: Start date in YYYY-MM-DD format
        end_date_str: End date in YYYY-MM-DD format
        categories: List of category IDs to filter by (None = all categories)
    
    Returns:
        List of events that overlap with the date range
    """
    all_events = []
    
    # Determine which categories to fetch
    if categories is None:
        categories = list(EVENT_CATEGORIES.keys())
    
    # Get government shutdowns (from JSON file)
    if 'government_shutdown' in categories:
        all_events.extend(get_shutdown_events(start_date_str, end_date_str))
    
    # Get Fed rate events (from FRED API)
    # Check if any fed category is requested
    fed_categories = {'fed_rate_hike', 'fed_rate_cut', 'fed_rate_hold'}
    requested_fed_categories = fed_categories.intersection(set(categories))
    
    if requested_fed_categories:
        # Determine if we need to include holds
        include_holds = 'fed_rate_hold' in categories
        fed_events = fetch_fed_rate_changes(start_date_str, end_date_str, include_holds=include_holds)
        
        for event in fed_events:
            if event['category'] in categories:
                all_events.append(event)
    
    # Sort by start date
    all_events.sort(key=lambda x: x['start_date'])
    
    return all_events


def get_all_categories() -> dict:
    """Get all available event categories with metadata."""
    return EVENT_CATEGORIES


def get_all_events() -> list:
    """Get all historical events (static data only, no API calls)."""
    all_events = []
    
    # Load government shutdowns from JSON file
    shutdowns = load_government_shutdowns()
    
    for shutdown in shutdowns:
        all_events.append({
            'id': shutdown['id'],
            'category': 'government_shutdown',
            'title': shutdown['title'],
            'description': shutdown['description'],
            'start_date': shutdown['start_date'],
            'end_date': shutdown['end_date'],
            'is_range': True,
        })
    
    # Sort by start date
    all_events.sort(key=lambda x: x['start_date'])
    
    return all_events
