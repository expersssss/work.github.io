import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qsl

from aiohttp import web

from aiogram import Bot, Dispatcher, F
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import CommandStart, Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    Message,
    CallbackQuery,
    ReplyKeyboardRemove,
    MenuButtonWebApp,
    WebAppInfo,
)
from aiogram.utils.keyboard import InlineKeyboardBuilder


# ============================================================
# НАСТРОЙКИ
# ============================================================

TOKEN = os.getenv(
    "BOT_TOKEN",
    "8837760493:AAFu40Q7qCphYe_Kh-rBrF2OUZZCuslh1cY"
)

ADMIN_IDS = {
    5662322727,
}

# ============================================================
# MINI APP
# ============================================================

# Для Telegram Mini App URL должен быть HTTPS.
#
# Например:
# MINI_APP_URL = "https://github.com/expersssss/work.github.io.git"
#
# Для локального теста понадобится tunnel:
# ngrok / Cloudflare Tunnel / другой HTTPS tunnel.

MINI_APP_URL = os.getenv(
    "MINI_APP_URL",
    "https://github.com/expersssss/work.github.io.git"
)

WEB_DIR = Path(__file__).parent / "web"

HOST = "0.0.0.0"
PORT = int(os.getenv("PORT", "8080"))

DB_NAME = "vacancies.db"

MIN_AGE = 14
MAX_AGE = 50


# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)

logger = logging.getLogger(__name__)


# ============================================================
# BOT
# ============================================================

bot = Bot(
    token=TOKEN,
    default=DefaultBotProperties(
        parse_mode=ParseMode.HTML
    )
)

dp = Dispatcher(
    storage=MemoryStorage()
)


# ============================================================
# DATABASE
# ============================================================

db = sqlite3.connect(
    DB_NAME,
    check_same_thread=False
)

db.row_factory = sqlite3.Row


def db_execute(query, params=()):
    cur = db.cursor()
    cur.execute(query, params)
    db.commit()
    return cur


def db_fetchone(query, params=()):
    cur = db.cursor()
    cur.execute(query, params)
    return cur.fetchone()


def db_fetchall(query, params=()):
    cur = db.cursor()
    cur.execute(query, params)
    return cur.fetchall()


def column_exists(table_name, column_name):
    rows = db_fetchall(
        f"PRAGMA table_info({table_name})"
    )

    for row in rows:
        if row["name"] == column_name:
            return True

    return False


def init_db():

    db_execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER UNIQUE,
            username TEXT,
            first_name TEXT,
            last_name TEXT,
            phone TEXT,
            city TEXT,
            age INTEGER,
            blocked_until TEXT,
            spam_count INTEGER DEFAULT 0,
            start_count INTEGER DEFAULT 0,
            last_start TEXT,
            created_at TEXT
        )
    """)

    db_execute("""
        CREATE TABLE IF NOT EXISTS vacancies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            category TEXT,
            salary TEXT,
            description TEXT,
            requirements TEXT,
            contact TEXT,
            employer_id INTEGER,
            created_at TEXT,
            active INTEGER DEFAULT 1
        )
    """)

    if not column_exists("vacancies", "employer_id"):
        db_execute(
            "ALTER TABLE vacancies ADD COLUMN employer_id INTEGER"
        )

    db_execute("""
        CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vacancy_id INTEGER,
            user_id INTEGER,
            name TEXT,
            age INTEGER,
            city TEXT,
            contact TEXT,
            message TEXT,
            created_at TEXT,
            status TEXT DEFAULT 'new'
        )
    """)

    db_execute("""
        CREATE TABLE IF NOT EXISTS favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            vacancy_id INTEGER,
            created_at TEXT,
            UNIQUE(user_id, vacancy_id)
        )
    """)

    db_execute("""
        CREATE TABLE IF NOT EXISTS spam_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER,
            reason TEXT,
            created_at TEXT
        )
    """)

    db_execute("""
        CREATE TABLE IF NOT EXISTS broadcasts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT,
            sent INTEGER DEFAULT 0,
            failed INTEGER DEFAULT 0,
            created_at TEXT
        )
    """)


init_db()


# ============================================================
# USERS
# ============================================================

def get_user(tg_id):

    return db_fetchone(
        """
        SELECT *
        FROM users
        WHERE telegram_id = ?
        """,
        (tg_id,)
    )


def create_user_from_telegram(
    telegram_id,
    username=None,
    first_name=None,
    last_name=None
):

    existing = get_user(telegram_id)

    if existing:
        return existing

    db_execute("""
        INSERT INTO users (
            telegram_id,
            username,
            first_name,
            last_name,
            created_at
        )
        VALUES (?, ?, ?, ?, ?)
    """, (
        telegram_id,
        username,
        first_name,
        last_name,
        datetime.now().isoformat()
    ))

    return get_user(telegram_id)


def update_user(tg_id, **kwargs):

    if not kwargs:
        return

    fields = []
    values = []

    for key, value in kwargs.items():
        fields.append(f"{key} = ?")
        values.append(value)

    values.append(tg_id)

    db_execute(
        f"""
        UPDATE users
        SET {", ".join(fields)}
        WHERE telegram_id = ?
        """,
        values
    )


# ============================================================
# HELPERS
# ============================================================

def row_to_dict(row):

    if not row:
        return None

    return {
        key: row[key]
        for key in row.keys()
    }


def rows_to_list(rows):

    return [
        row_to_dict(row)
        for row in rows
    ]


def is_admin(user_id):

    return user_id in ADMIN_IDS


def safe_text(value):

    if value is None:
        return ""

    return str(value)


# ============================================================
# TELEGRAM MINI APP AUTH
# ============================================================

def validate_telegram_init_data(init_data):

    if not init_data:
        return None

    try:

        parsed = dict(
            parse_qsl(
                init_data,
                keep_blank_values=True
            )
        )

        received_hash = parsed.pop(
            "hash",
            None
        )

        if not received_hash:
            return None

        data_check_string = "\n".join(
            f"{key}={parsed[key]}"
            for key in sorted(parsed)
        )

        secret_key = hmac.new(
            b"WebAppData",
            TOKEN.encode(),
            hashlib.sha256
        ).digest()

        calculated_hash = hmac.new(
            secret_key,
            data_check_string.encode(),
            hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(
            calculated_hash,
            received_hash
        ):
            return None

        user_data = parsed.get("user")

        if not user_data:
            return None

        return json.loads(user_data)

    except Exception as e:

        logger.error(
            "Mini App auth error: %s",
            e
        )

        return None


async def get_miniapp_user(request):

    init_data = request.headers.get(
        "X-Telegram-Init-Data"
    )

    user_data = validate_telegram_init_data(
        init_data
    )

    if not user_data:
        return None

    telegram_id = user_data.get("id")

    if not telegram_id:
        return None

    create_user_from_telegram(
        telegram_id,
        user_data.get("username"),
        user_data.get("first_name"),
        user_data.get("last_name")
    )

    return user_data


# ============================================================
# API RESPONSE
# ============================================================

def json_response(data, status=200):

    return web.json_response(
        data,
        status=status,
        dumps=lambda x: json.dumps(
            x,
            ensure_ascii=False
        )
    )


# ============================================================
# MINI APP API
# ============================================================

async def api_me(request):

    user = await get_miniapp_user(request)

    if not user:
        return json_response(
            {
                "ok": False,
                "error": "Unauthorized"
            },
            401
        )

    db_user = get_user(
        user["id"]
    )

    return json_response({
        "ok": True,
        "user": row_to_dict(db_user),
        "is_admin": is_admin(user["id"])
    })


async def api_vacancies(request):

    user = await get_miniapp_user(request)

    if not user:
        return json_response(
            {
                "ok": False,
                "error": "Unauthorized"
            },
            401
        )

    search = request.query.get(
        "search",
        ""
    ).strip()

    category = request.query.get(
        "category",
        ""
    ).strip()

    city = request.query.get(
        "city",
        ""
    ).strip()

    query = """
        SELECT *
        FROM vacancies
        WHERE active = 1
    """

    params = []

    if search:

        query += """
            AND (
                title LIKE ?
                OR category LIKE ?
                OR description LIKE ?
                OR requirements LIKE ?
            )
        """

        search_value = f"%{search}%"

        params.extend([
            search_value,
            search_value,
            search_value,
            search_value
        ])

    if category:

        query += """
            AND category = ?
        """

        params.append(category)

    # В текущей структуре вакансии город не хранится.
    # Поэтому city используется как дополнительный
    # поиск по описанию.

    if city:

        query += """
            AND (
                description LIKE ?
                OR requirements LIKE ?
                OR title LIKE ?
            )
        """

        city_value = f"%{city}%"

        params.extend([
            city_value,
            city_value,
            city_value
        ])

    query += """
        ORDER BY id DESC
        LIMIT 100
    """

    rows = db_fetchall(
        query,
        params
    )

    result = []

    for row in rows:

        item = row_to_dict(row)

        favorite = db_fetchone(
            """
            SELECT id
            FROM favorites
            WHERE user_id = ?
            AND vacancy_id = ?
            """,
            (
                user["id"],
                row["id"]
            )
        )

        item["favorite"] = bool(
            favorite
        )

        result.append(item)

    return json_response({
        "ok": True,
        "vacancies": result
    })


async def api_vacancy(request):

    user = await get_miniapp_user(request)

    if not user:
        return json_response(
            {
                "ok": False,
                "error": "Unauthorized"
            },
            401
        )

    try:
        vacancy_id = int(
            request.match_info["vacancy_id"]
        )
    except Exception:
        return json_response(
            {
                "ok": False,
                "error": "Invalid ID"
            },
            400
        )

    vacancy = db_fetchone(
        """
        SELECT *
        FROM vacancies
        WHERE id = ?
        AND active = 1
        """,
        (vacancy_id,)
    )

    if not vacancy:

        return json_response(
            {
                "ok": False,
                "error": "Vacancy not found"
            },
            404
        )

    favorite = db_fetchone(
        """
        SELECT id
        FROM favorites
        WHERE user_id = ?
        AND vacancy_id = ?
        """,
        (
            user["id"],
            vacancy_id
        )
    )

    item = row_to_dict(
        vacancy
    )

    item["favorite"] = bool(
        favorite
    )

    return json_response({
        "ok": True,
        "vacancy": item
    })


async def api_categories(request):

    user = await get_miniapp_user(request)

    if not user:
        return json_response(
            {
                "ok": False
            },
            401
        )

    rows = db_fetchall("""
        SELECT category, COUNT(*) AS count
        FROM vacancies
        WHERE active = 1
        AND category IS NOT NULL
        AND category != ''
        GROUP BY category
        ORDER BY count DESC
    """)

    return json_response({
        "ok": True,
        "categories": [
            {
                "name": row["category"],
                "count": row["count"]
            }
            for row in rows
        ]
    })


async def api_favorites(request):

    user = await get_miniapp_user(request)

    if not user:
        return json_response(
            {
                "ok": False
            },
            401
        )

    rows = db_fetchall("""
        SELECT vacancies.*
        FROM vacancies
        INNER JOIN favorites
            ON favorites.vacancy_id = vacancies.id
        WHERE favorites.user_id = ?
        AND vacancies.active = 1
        ORDER BY favorites.id DESC
    """, (
        user["id"],
    ))

    result = []

    for row in rows:

        item = row_to_dict(row)
        item["favorite"] = True

        result.append(item)

    return json_response({
        "ok": True,
        "vacancies": result
    })


async def api_favorite_toggle(request):

    user = await get_miniapp_user(request)

    if not user:
        return json_response(
            {
                "ok": False
            },
            401
        )

    try:
        data = await request.json()

        vacancy_id = int(
            data.get("vacancy_id")
        )

    except Exception:

        return json_response(
            {
                "ok": False,
                "error": "Invalid data"
            },
            400
        )

    vacancy = db_fetchone(
        """
        SELECT id
        FROM vacancies
        WHERE id = ?
        AND active = 1
        """,
        (vacancy_id,)
    )

    if not vacancy:

        return json_response(
            {
                "ok": False,
                "error": "Vacancy not found"
            },
            404
        )

    favorite = db_fetchone(
        """
        SELECT id
        FROM favorites
        WHERE user_id = ?
        AND vacancy_id = ?
        """,
        (
            user["id"],
            vacancy_id
        )
    )

    if favorite:

        db_execute(
            """
            DELETE FROM favorites
            WHERE user_id = ?
            AND vacancy_id = ?
            """,
            (
                user["id"],
                vacancy_id
            )
        )

        result = False

    else:

        db_execute(
            """
            INSERT OR IGNORE INTO favorites (
                user_id,
                vacancy_id,
                created_at
            )
            VALUES (?, ?, ?)
            """,
            (
                user["id"],
                vacancy_id,
                datetime.now().isoformat()
            )
        )

        result = True

    return json_response({
        "ok": True,
        "favorite": result
    })


# ============================================================
# APPLICATION FROM MINI APP
# ============================================================

async def api_apply(request):

    user = await get_miniapp_user(request)

    if not user:
        return json_response(
            {
                "ok": False,
                "error": "Unauthorized"
            },
            401
        )

    try:

        data = await request.json()

        vacancy_id = int(
            data.get("vacancy_id")
        )

        age = int(
            data.get("age")
        )

        city = str(
            data.get("city", "")
        ).strip()

        contact = str(
            data.get("contact", "")
        ).strip()

        message = str(
            data.get("message", "")
        ).strip()

    except Exception:

        return json_response(
            {
                "ok": False,
                "error": "Некорректные данные"
            },
            400
        )

    if not MIN_AGE <= age <= MAX_AGE:

        return json_response(
            {
                "ok": False,
                "error": (
                    f"Возраст должен быть "
                    f"от {MIN_AGE} до {MAX_AGE}"
                )
            },
            400
        )

    if len(city) < 2:

        return json_response(
            {
                "ok": False,
                "error": "Укажите город"
            },
            400
        )

    if len(contact) < 3:

        return json_response(
            {
                "ok": False,
                "error": "Укажите контакт"
            },
            400
        )

    if len(message) < 5:

        return json_response(
            {
                "ok": False,
                "error": "Расскажите немного о себе"
            },
            400
        )

    if len(message) > 1000:

        return json_response(
            {
                "ok": False,
                "error": "Сообщение слишком длинное"
            },
            400
        )

    vacancy = db_fetchone(
        """
        SELECT *
        FROM vacancies
        WHERE id = ?
        AND active = 1
        """,
        (vacancy_id,)
    )

    if not vacancy:

        return json_response(
            {
                "ok": False,
                "error": "Вакансия недоступна"
            },
            404
        )

    db_user = get_user(
        user["id"]
    )

    db_execute("""
        INSERT INTO applications (
            vacancy_id,
            user_id,
            name,
            age,
            city,
            contact,
            message,
            created_at,
            status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')
    """, (
        vacancy_id,
        user["id"],
        db_user["first_name"] or user.get("first_name"),
        age,
        city,
        contact,
        message,
        datetime.now().isoformat()
    ))

    application_id = db.execute(
        "SELECT last_insert_rowid()"
    ).fetchone()[0]

    # Уведомляем администраторов.

    admin_text = (
        "📩 <b>НОВЫЙ ОТКЛИК ИЗ MINI APP</b>\n\n"
        f"🆔 Отклик: <code>{application_id}</code>\n"
        f"💼 Вакансия: "
        f"{vacancy['title']}\n\n"
        f"👤 Имя: "
        f"{db_user['first_name'] or '—'}\n"
        f"🎂 Возраст: {age}\n"
        f"🏙️ Город: {city}\n"
        f"📞 Контакт: {contact}\n\n"
        f"📝 О себе:\n{message}\n\n"
        f"🆔 Telegram ID: "
        f"<code>{user['id']}</code>"
    )

    for admin_id in ADMIN_IDS:

        try:

            await bot.send_message(
                admin_id,
                admin_text
            )

        except Exception as e:

            logger.error(
                "Application notification: %s",
                e
            )

    return json_response({
        "ok": True,
        "application_id": application_id
    })


# ============================================================
# MY APPLICATIONS
# ============================================================

async def api_my_applications(request):

    user = await get_miniapp_user(request)

    if not user:
        return json_response(
            {
                "ok": False
            },
            401
        )

    rows = db_fetchall("""
        SELECT
            applications.*,
            vacancies.title
        FROM applications
        LEFT JOIN vacancies
            ON vacancies.id = applications.vacancy_id
        WHERE applications.user_id = ?
        ORDER BY applications.id DESC
    """, (
        user["id"],
    ))

    return json_response({
        "ok": True,
        "applications": rows_to_list(rows)
    })


# ============================================================
# UPDATE PROFILE
# ============================================================

async def api_profile_update(request):

    user = await get_miniapp_user(request)

    if not user:
        return json_response(
            {
                "ok": False
            },
            401
        )

    try:

        data = await request.json()

        first_name = str(
            data.get("first_name", "")
        ).strip()

        city = str(
            data.get("city", "")
        ).strip()

        age = int(
            data.get("age")
        )

        username = str(
            data.get("username", "")
        ).strip()

    except Exception:

        return json_response(
            {
                "ok": False,
                "error": "Некорректные данные"
            },
            400
        )

    if len(first_name) < 2:

        return json_response(
            {
                "ok": False,
                "error": "Укажите имя"
            },
            400
        )

    if len(city) < 2:

        return json_response(
            {
                "ok": False,
                "error": "Укажите город"
            },
            400
        )

    if not MIN_AGE <= age <= MAX_AGE:

        return json_response(
            {
                "ok": False,
                "error": "Некорректный возраст"
            },
            400
        )

    update_user(
        user["id"],
        first_name=first_name,
        city=city,
        age=age,
        username=username.lstrip("@")
    )

    return json_response({
        "ok": True,
        "user": row_to_dict(
            get_user(user["id"])
        )
    })


# ============================================================
# ADMIN API
# ============================================================

async def admin_check(request):

    user = await get_miniapp_user(request)

    if not user:
        return None, json_response(
            {
                "ok": False,
                "error": "Unauthorized"
            },
            401
        )

    if not is_admin(user["id"]):

        return None, json_response(
            {
                "ok": False,
                "error": "Нет доступа"
            },
            403
        )

    return user, None


async def api_admin_stats(request):

    user, error = await admin_check(request)

    if error:
        return error

    users = db_fetchone(
        "SELECT COUNT(*) AS c FROM users"
    )["c"]

    vacancies = db_fetchone(
        """
        SELECT COUNT(*) AS c
        FROM vacancies
        WHERE active = 1
        """
    )["c"]

    applications = db_fetchone(
        """
        SELECT COUNT(*) AS c
        FROM applications
        """
    )["c"]

    return json_response({
        "ok": True,
        "stats": {
            "users": users,
            "vacancies": vacancies,
            "applications": applications
        }
    })


async def api_admin_vacancies(request):

    user, error = await admin_check(request)

    if error:
        return error

    rows = db_fetchall("""
        SELECT *
        FROM vacancies
        ORDER BY id DESC
    """)

    return json_response({
        "ok": True,
        "vacancies": rows_to_list(rows)
    })


async def api_admin_create_vacancy(request):

    user, error = await admin_check(request)

    if error:
        return error

    try:

        data = await request.json()

        title = str(
            data.get("title", "")
        ).strip()

        category = str(
            data.get("category", "")
        ).strip()

        salary = str(
            data.get("salary", "")
        ).strip()

        description = str(
            data.get("description", "")
        ).strip()

        requirements = str(
            data.get("requirements", "")
        ).strip()

        contact = str(
            data.get("contact", "")
        ).strip()

    except Exception:

        return json_response(
            {
                "ok": False,
                "error": "Некорректные данные"
            },
            400
        )

    if len(title) < 2:

        return json_response(
            {
                "ok": False,
                "error": "Введите название"
            },
            400
        )

    db_execute("""
        INSERT INTO vacancies (
            title,
            category,
            salary,
            description,
            requirements,
            contact,
            employer_id,
            created_at,
            active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    """, (
        title,
        category,
        salary,
        description,
        requirements,
        contact,
        user["id"],
        datetime.now().isoformat()
    ))

    vacancy_id = db.execute(
        "SELECT last_insert_rowid()"
    ).fetchone()[0]

    return json_response({
        "ok": True,
        "vacancy_id": vacancy_id
    })


async def api_admin_toggle_vacancy(request):

    user, error = await admin_check(request)

    if error:
        return error

    try:

        vacancy_id = int(
            request.match_info["vacancy_id"]
        )

    except Exception:

        return json_response(
            {
                "ok": False,
                "error": "Invalid ID"
            },
            400
        )

    vacancy = db_fetchone(
        """
        SELECT active
        FROM vacancies
        WHERE id = ?
        """,
        (vacancy_id,)
    )

    if not vacancy:

        return json_response(
            {
                "ok": False,
                "error": "Не найдено"
            },
            404
        )

    new_status = 0 if vacancy["active"] else 1

    db_execute(
        """
        UPDATE vacancies
        SET active = ?
        WHERE id = ?
        """,
        (
            new_status,
            vacancy_id
        )
    )

    return json_response({
        "ok": True,
        "active": bool(new_status)
    })


async def api_admin_delete_vacancy(request):

    user, error = await admin_check(request)

    if error:
        return error

    try:

        vacancy_id = int(
            request.match_info["vacancy_id"]
        )

    except Exception:

        return json_response(
            {
                "ok": False
            },
            400
        )

    db_execute(
        """
        DELETE FROM vacancies
        WHERE id = ?
        """,
        (vacancy_id,)
    )

    return json_response({
        "ok": True
    })


async def api_admin_applications(request):

    user, error = await admin_check(request)

    if error:
        return error

    rows = db_fetchall("""
        SELECT
            applications.*,
            vacancies.title
        FROM applications
        LEFT JOIN vacancies
            ON vacancies.id = applications.vacancy_id
        ORDER BY applications.id DESC
        LIMIT 100
    """)

    return json_response({
        "ok": True,
        "applications": rows_to_list(rows)
    })


# ============================================================
# MINI APP SERVER
# ============================================================

async def health(request):

    return json_response({
        "ok": True,
        "service": "telegram-mini-app"
    })


def create_web_app():

    app = web.Application()

    # API
    app.router.add_get(
        "/api/me",
        api_me
    )

    app.router.add_get(
        "/api/vacancies",
        api_vacancies
    )

    app.router.add_get(
        "/api/vacancy/{vacancy_id}",
        api_vacancy
    )

    app.router.add_get(
        "/api/categories",
        api_categories
    )

    app.router.add_get(
        "/api/favorites",
        api_favorites
    )

    app.router.add_post(
        "/api/favorite",
        api_favorite_toggle
    )

    app.router.add_post(
        "/api/apply",
        api_apply
    )

    app.router.add_get(
        "/api/my-applications",
        api_my_applications
    )

    app.router.add_post(
        "/api/profile",
        api_profile_update
    )

    # ADMIN
    app.router.add_get(
        "/api/admin/stats",
        api_admin_stats
    )

    app.router.add_get(
        "/api/admin/vacancies",
        api_admin_vacancies
    )

    app.router.add_post(
        "/api/admin/vacancy",
        api_admin_create_vacancy
    )

    app.router.add_post(
        "/api/admin/vacancy/{vacancy_id}/toggle",
        api_admin_toggle_vacancy
    )

    app.router.add_delete(
        "/api/admin/vacancy/{vacancy_id}",
        api_admin_delete_vacancy
    )

    app.router.add_get(
        "/api/admin/applications",
        api_admin_applications
    )

    app.router.add_get(
        "/health",
        health
    )

    # STATIC
    if WEB_DIR.exists():

        app.router.add_static(
            "/",
            WEB_DIR,
            show_index=True
        )

    else:

        async def no_web(request):

            return web.Response(
                text="Папка web не найдена."
            )

        app.router.add_get(
            "/",
            no_web
        )

    return app


async def start_web_server():

    app = create_web_app()

    runner = web.AppRunner(
        app
    )

    await runner.setup()

    site = web.TCPSite(
        runner,
        HOST,
        PORT
    )

    await site.start()

    logger.info(
        "Mini App server started on %s:%s",
        HOST,
        PORT
    )

    return runner


# ============================================================
# TELEGRAM BOT
# ============================================================

@dp.message(CommandStart())
async def start_handler(message: Message):

    user = create_user_from_telegram(
        message.from_user.id,
        message.from_user.username,
        message.from_user.first_name,
        message.from_user.last_name
    )

    builder = InlineKeyboardBuilder()

    if (
        MINI_APP_URL
        and "YOUR-DOMAIN" not in MINI_APP_URL
    ):

        builder.button(
            text="🚀 Открыть приложение",
            web_app=WebAppInfo(
                url=MINI_APP_URL
            )
        )

    builder.button(
        text="📋 Вакансии",
        callback_data="vacancies"
    )

    if is_admin(
        message.from_user.id
    ):

        builder.button(
            text="⚙️ Админ-панель",
            callback_data="admin"
        )

    builder.adjust(1)

    await message.answer(
        "👋 <b>Добро пожаловать!</b>\n\n"
        "Здесь можно искать работу, "
        "смотреть вакансии и отправлять отклики.\n\n"
        "🚀 Для полноценного интерфейса "
        "откройте Mini App:",
        reply_markup=builder.as_markup()
    )


@dp.callback_query(
    F.data == "vacancies"
)
async def vacancies_callback(
    callback: CallbackQuery
):

    rows = db_fetchall("""
        SELECT *
        FROM vacancies
        WHERE active = 1
        ORDER BY id DESC
        LIMIT 50
    """)

    if not rows:

        await callback.message.answer(
            "📭 Сейчас вакансий нет."
        )

        await callback.answer()

        return

    builder = InlineKeyboardBuilder()

    for vacancy in rows:

        builder.button(
            text=(
                f"💼 "
                f"{vacancy['title'][:45]}"
            ),
            callback_data=(
                f"vacancy:"
                f"{vacancy['id']}"
            )
        )

    builder.adjust(1)

    await callback.message.answer(
        "📋 <b>Последние вакансии:</b>",
        reply_markup=builder.as_markup()
    )

    await callback.answer()


@dp.callback_query(
    F.data.startswith("vacancy:")
)
async def vacancy_callback(
    callback: CallbackQuery
):

    try:

        vacancy_id = int(
            callback.data.split(":")[1]
        )

    except Exception:

        await callback.answer(
            "Ошибка.",
            show_alert=True
        )

        return

    vacancy = db_fetchone(
        """
        SELECT *
        FROM vacancies
        WHERE id = ?
        AND active = 1
        """,
        (vacancy_id,)
    )

    if not vacancy:

        await callback.answer(
            "Вакансия не найдена.",
            show_alert=True
        )

        return

    text = (
        f"💼 <b>{vacancy['title']}</b>\n\n"
        f"📂 {vacancy['category'] or 'Без категории'}\n"
        f"💰 {vacancy['salary'] or 'Не указана'}\n\n"
        f"📝 {vacancy['description'] or '—'}\n\n"
        f"📌 {vacancy['requirements'] or 'Без требований'}"
    )

    await callback.message.answer(
        text
    )

    await callback.answer()


@dp.callback_query(
    F.data == "admin"
)
async def admin_callback(
    callback: CallbackQuery
):

    if not is_admin(
        callback.from_user.id
    ):

        await callback.answer(
            "Нет доступа.",
            show_alert=True
        )

        return

    await callback.message.answer(
        "⚙️ <b>Админ-панель</b>\n\n"
        "Для полного управления "
        "используйте Mini App."
    )

    await callback.answer()


# ============================================================
# BOT MENU BUTTON
# ============================================================

async def configure_bot():

    if (
        MINI_APP_URL
        and "YOUR-DOMAIN" not in MINI_APP_URL
    ):

        try:

            await bot.set_chat_menu_button(
                menu_button=MenuButtonWebApp(
                    text="💼 Работа",
                    web_app=WebAppInfo(
                        url=MINI_APP_URL
                    )
                )
            )

            logger.info(
                "Telegram Mini App menu button configured."
            )

        except Exception as e:

            logger.error(
                "Menu button error: %s",
                e
            )


# ============================================================
# MAIN
# ============================================================

async def main():

    if TOKEN == "ВСТАВЬ_СЮДА_ТОКЕН_БОТА":

        raise RuntimeError(
            "Укажи TOKEN в boti.py "
            "или переменную окружения BOT_TOKEN."
        )

    logger.info(
        "Бот запускается..."
    )

    logger.info(
        "Администраторы: %s",
        ADMIN_IDS
    )

    await bot.delete_webhook(
        drop_pending_updates=True
    )

    await configure_bot()

    web_runner = await start_web_server()

    try:

        await dp.start_polling(
            bot
        )

    finally:

        await web_runner.cleanup()

        await bot.session.close()

        db.close()


if __name__ == "__main__":

    try:

        asyncio.run(
            main()
        )

    except KeyboardInterrupt:

        logger.info(
            "Бот остановлен."
        )