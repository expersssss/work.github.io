const tg = window.Telegram?.WebApp;

if (tg) {
tg.ready();
tg.expand();
}

// ============================================================
// STATE
// ============================================================

let currentUser = null;
let isAdmin = false;

let currentCategory = "";
let currentSearch = "";
let currentCity = "";

let vacancies = [];
let categories = [];

let currentVacancy = null;

// ============================================================
// API
// ============================================================

async function api(url, options = {}) {

```
const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
};

// Telegram Mini App authentication
if (tg && tg.initData) {
    headers["X-Telegram-Init-Data"] = tg.initData;
}

const response = await fetch(url, {
    ...options,
    headers
});

let data;

try {
    data = await response.json();
} catch {
    throw new Error("Сервер вернул некорректный ответ");
}

if (!response.ok || data.ok === false) {
    throw new Error(
        data.error || `Ошибка сервера: ${response.status}`
    );
}

return data;
```

}

// ============================================================
// INIT
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {

```
setupSearch();

await loadUser();
await loadCategories();
await loadVacancies();

if (tg) {
    tg.onEvent("themeChanged", applyTelegramTheme);
    applyTelegramTheme();
}
```

});

// ============================================================
// USER
// ============================================================

async function loadUser() {

```
try {

    const data = await api("/api/me");

    currentUser = data.user;
    isAdmin = Boolean(data.is_admin);

    updateHello();

} catch (error) {

    console.error(error);

    showError(
        "Не удалось загрузить профиль.\n" +
        "Откройте приложение именно через Telegram."
    );
}
```

}

function updateHello() {

```
const hello = document.getElementById("hello");

if (!hello) return;

if (currentUser?.first_name) {
    hello.textContent =
        `Привет, ${currentUser.first_name}!`;
} else {
    hello.textContent =
        "Поиск работы";
}
```

}

// ============================================================
// CATEGORIES
// ============================================================

async function loadCategories() {

```
try {

    const data = await api("/api/categories");

    categories = data.categories || [];

    renderCategories();

} catch (error) {

    console.error(error);
}
```

}

function renderCategories() {

```
const container =
    document.getElementById("categories");

if (!container) return;

container.innerHTML = "";

const allButton = document.createElement("button");

allButton.className =
    "category" +
    (currentCategory === "" ? " active" : "");

allButton.textContent = "Все";

allButton.onclick = () => {
    selectCategory("");
};

container.appendChild(allButton);


categories.forEach(category => {

    const button =
        document.createElement("button");

    button.className =
        "category" +
        (
            currentCategory === category.name
                ? " active"
                : ""
        );

    button.innerHTML =
        `${escapeHtml(category.name)}
         <span>${category.count}</span>`;

    button.onclick = () => {
        selectCategory(category.name);
    };

    container.appendChild(button);
});
```

}

function selectCategory(category) {

```
currentCategory = category;

renderCategories();
loadVacancies();
```

}

// ============================================================
// VACANCIES
// ============================================================

async function loadVacancies() {

```
showLoading();

try {

    const params = new URLSearchParams();

    if (currentSearch) {
        params.set(
            "search",
            currentSearch
        );
    }

    if (currentCategory) {
        params.set(
            "category",
            currentCategory
        );
    }

    if (currentCity) {
        params.set(
            "city",
            currentCity
        );
    }

    const query =
        params.toString()
            ? `?${params.toString()}`
            : "";

    const data =
        await api(
            `/api/vacancies${query}`
        );

    vacancies =
        data.vacancies || [];

    renderVacancies();

} catch (error) {

    console.error(error);

    showError(
        error.message ||
        "Не удалось загрузить вакансии"
    );
}
```

}

function renderVacancies() {

```
const content =
    document.getElementById("content");

if (!content) return;

if (!vacancies.length) {

    content.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">📭</div>
            <h3>Вакансий не найдено</h3>
            <p>
                Попробуйте изменить поиск
                или выбрать другую категорию.
            </p>
        </div>
    `;

    return;
}

content.innerHTML = `
    <div class="results-header">
        <span>Найдено вакансий</span>
        <b>${vacancies.length}</b>
    </div>

    <div class="vacancies-list">
        ${vacancies
            .map(renderVacancyCard)
            .join("")}
    </div>
`;
```

}

function renderVacancyCard(vacancy) {

```
const favoriteClass =
    vacancy.favorite
        ? "favorite active"
        : "favorite";

const favoriteIcon =
    vacancy.favorite
        ? "❤️"
        : "♡";

return `
    <article
        class="vacancy-card"
        onclick="openVacancy(${vacancy.id})"
    >

        <div class="vacancy-top">

            <div class="vacancy-icon">
                💼
            </div>

            <button
                class="${favoriteClass}"
                onclick="
                    event.stopPropagation();
                    toggleFavorite(${vacancy.id});
                "
            >
                ${favoriteIcon}
            </button>

        </div>

        <h3>
            ${escapeHtml(
                vacancy.title || "Без названия"
            )}
        </h3>

        <div class="vacancy-meta">

            ${
                vacancy.category
                ? `
                <span class="tag">
                    📂
                    ${escapeHtml(
                        vacancy.category
                    )}
                </span>
                `
                : ""
            }

            ${
                vacancy.salary
                ? `
                <span class="salary">
                    💰
                    ${escapeHtml(
                        vacancy.salary
                    )}
                </span>
                `
                : ""
            }

        </div>

        ${
            vacancy.description
            ? `
            <p class="vacancy-description">
                ${escapeHtml(
                    truncate(
                        vacancy.description,
                        150
                    )
                )}
            </p>
            `
            : ""
        }

        <div class="vacancy-footer">
            <span>
                Подробнее →
            </span>
        </div>

    </article>
`;
```

}

// ============================================================
// VACANCY DETAILS
// ============================================================

async function openVacancy(id) {

```
try {

    const data =
        await api(
            `/api/vacancy/${id}`
        );

    currentVacancy =
        data.vacancy;

    const modal =
        document.getElementById(
            "vacancyModal"
        );

    const content =
        document.getElementById(
            "vacancyContent"
        );

    content.innerHTML = `
        <div class="vacancy-detail">

            <div class="detail-icon">
                💼
            </div>

            <h2>
                ${escapeHtml(
                    currentVacancy.title
                )}
            </h2>

            ${
                currentVacancy.category
                ? `
                <div class="detail-row">
                    <span>Категория</span>
                    <b>
                        ${escapeHtml(
                            currentVacancy.category
                        )}
                    </b>
                </div>
                `
                : ""
            }

            ${
                currentVacancy.salary
                ? `
                <div class="detail-row">
                    <span>Оплата</span>
                    <b class="detail-salary">
                        ${escapeHtml(
                            currentVacancy.salary
                        )}
                    </b>
                </div>
                `
                : ""
            }

            ${
                currentVacancy.description
                ? `
                <div class="detail-section">
                    <h4>📝 Описание</h4>
                    <p>
                        ${nl2br(
                            escapeHtml(
                                currentVacancy.description
                            )
                        )}
                    </p>
                </div>
                `
                : ""
            }

            ${
                currentVacancy.requirements
                ? `
                <div class="detail-section">
                    <h4>📌 Требования</h4>
                    <p>
                        ${nl2br(
                            escapeHtml(
                                currentVacancy.requirements
                            )
                        )}
                    </p>
                </div>
                `
                : ""
            }

            <button
                class="primary-button"
                onclick="openApplication()"
            >
                📩 Откликнуться
            </button>

            <button
                class="secondary-button"
                onclick="
                    toggleFavorite(
                        ${currentVacancy.id}
                    )
                "
            >
                ${
                    currentVacancy.favorite
                        ? "❤️ Убрать из избранного"
                        : "♡ Добавить в избранное"
                }
            </button>

        </div>
    `;

    modal.classList.remove("hidden");

    if (tg?.BackButton) {
        tg.BackButton.show();
        tg.BackButton.onClick(closeModal);
    }

} catch (error) {

    showToast(
        error.message ||
        "Ошибка загрузки вакансии"
    );
}
```

}

function closeModal() {

```
const modal =
    document.getElementById(
        "vacancyModal"
    );

modal?.classList.add("hidden");

currentVacancy = null;

if (tg?.BackButton) {
    tg.BackButton.hide();
}
```

}

// ============================================================
// FAVORITES
// ============================================================

async function toggleFavorite(vacancyId) {

```
try {

    const data =
        await api(
            "/api/favorite",
            {
                method: "POST",
                body: JSON.stringify({
                    vacancy_id: vacancyId
                })
            }
        );

    const vacancy =
        vacancies.find(
            item =>
                item.id === vacancyId
        );

    if (vacancy) {
        vacancy.favorite =
            data.favorite;
    }

    if (
        currentVacancy &&
        currentVacancy.id === vacancyId
    ) {
        currentVacancy.favorite =
            data.favorite;
    }

    renderVacancies();

    if (
        currentVacancy &&
        currentVacancy.id === vacancyId
    ) {
        openVacancy(vacancyId);
    }

    showToast(
        data.favorite
            ? "Добавлено в избранное ❤️"
            : "Удалено из избранного"
    );

} catch (error) {

    showToast(
        error.message ||
        "Не удалось изменить избранное"
    );
}
```

}

async function showFavorites() {

```
setActiveNav(1);

showLoading();

try {

    const data =
        await api(
            "/api/favorites"
        );

    const list =
        data.vacancies || [];

    renderVacancyCollection(
        list,
        "❤️ Избранное",
        "В избранном пока ничего нет."
    );

} catch (error) {

    showError(error.message);
}
```

}

// ============================================================
// APPLICATION
// ============================================================

function openApplication() {

```
if (!currentVacancy) {
    showToast("Вакансия не выбрана");
    return;
}

closeModal();

const modal =
    document.getElementById(
        "applicationModal"
    );

modal.classList.remove("hidden");

if (currentUser) {

    const age =
        document.getElementById(
            "applyAge"
        );

    const city =
        document.getElementById(
            "applyCity"
        );

    if (
        age &&
        currentUser.age
    ) {
        age.value =
            currentUser.age;
    }

    if (
        city &&
        currentUser.city
    ) {
        city.value =
            currentUser.city;
    }
}
```

}

function closeApplication() {

```
document
    .getElementById(
        "applicationModal"
    )
    ?.classList.add("hidden");
```

}

async function sendApplication() {

```
if (!currentVacancy) {
    showToast("Вакансия не выбрана");
    return;
}

const age =
    document.getElementById(
        "applyAge"
    ).value;

const city =
    document.getElementById(
        "applyCity"
    ).value.trim();

const contact =
    document.getElementById(
        "applyContact"
    ).value.trim();

const message =
    document.getElementById(
        "applyMessage"
    ).value.trim();


if (!age) {
    showToast("Укажите возраст");
    return;
}

if (!city) {
    showToast("Укажите город");
    return;
}

if (!contact) {
    showToast("Укажите контакт");
    return;
}

if (message.length < 5) {
    showToast(
        "Расскажите немного о себе"
    );
    return;
}


const button =
    document.querySelector(
        "#applicationModal .primary-button"
    );

if (button) {
    button.disabled = true;
    button.textContent =
        "Отправляем...";
}


try {

    const data =
        await api(
            "/api/apply",
            {
                method: "POST",
                body: JSON.stringify({
                    vacancy_id:
                        currentVacancy.id,
                    age: Number(age),
                    city,
                    contact,
                    message
                })
            }
        );

    showToast(
        `Отклик отправлен! №${data.application_id}`
    );

    closeApplication();

    document.getElementById(
        "applyMessage"
    ).value = "";

} catch (error) {

    showToast(
        error.message ||
        "Не удалось отправить отклик"
    );

} finally {

    if (button) {
        button.disabled = false;
        button.textContent =
            "📩 Отправить отклик";
    }
}
```

}

// ============================================================
// MY APPLICATIONS
// ============================================================

async function showApplications() {

```
setActiveNav(2);

showLoading();

try {

    const data =
        await api(
            "/api/my-applications"
        );

    const applications =
        data.applications || [];

    renderApplications(
        applications
    );

} catch (error) {

    showError(
        error.message ||
        "Не удалось загрузить отклики"
    );
}
```

}

function renderApplications(applications) {

```
const content =
    document.getElementById(
        "content"
    );

if (!applications.length) {

    content.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">📩</div>
            <h3>Откликов пока нет</h3>
            <p>
                Откройте вакансию
                и отправьте первый отклик.
            </p>
        </div>
    `;

    return;
}


content.innerHTML = `
    <div class="page-title">
        📩 Мои отклики
    </div>

    <div class="applications-list">

        ${applications.map(application => {

            const status =
                getStatus(application.status);

            return `
                <div class="application-card">

                    <div class="application-header">

                        <h3>
                            ${escapeHtml(
                                application.title ||
                                "Вакансия"
                            )}
                        </h3>

                        <span
                            class="status ${status.class}"
                        >
                            ${status.text}
                        </span>

                    </div>

                    <div class="application-info">

                        <span>
                            🏙️
                            ${escapeHtml(
                                application.city ||
                                "—"
                            )}
                        </span>

                        <span>
                            🎂
                            ${application.age}
                        </span>

                    </div>

                    ${
                        application.message
                        ? `
                        <p>
                            ${nl2br(
                                escapeHtml(
                                    application.message
                                )
                            )}
                        </p>
                        `
                        : ""
                    }

                    <small>
                        ${
                            formatDate(
                                application.created_at
                            )
                        }
                    </small>

                </div>
            `;

        }).join("")}

    </div>
`;
```

}

// ============================================================
// PROFILE
// ============================================================

async function openProfile() {

```
try {

    const data =
        await api("/api/me");

    currentUser =
        data.user;

    isAdmin =
        Boolean(data.is_admin);

    renderProfile();

    document
        .getElementById(
            "profileModal"
        )
        .classList.remove("hidden");

} catch (error) {

    showToast(
        error.message ||
        "Ошибка профиля"
    );
}
```

}

function renderProfile() {

```
const content =
    document.getElementById(
        "profileContent"
    );

if (!content) return;


content.innerHTML = `

    <div class="profile-avatar">
        👤
    </div>

    <div class="profile-name">
        ${escapeHtml(
            currentUser?.first_name ||
            "Пользователь"
        )}
    </div>

    ${
        currentUser?.username
        ? `
        <div class="profile-username">
            @${escapeHtml(
                currentUser.username
            )}
        </div>
        `
        : ""
    }


    <div class="profile-form">

        <label>
            Имя
        </label>

        <input
            id="profileName"
            value="${escapeAttribute(
                currentUser?.first_name || ""
            )}"
            placeholder="Ваше имя"
        >


        <label>
            Город
        </label>

        <input
            id="profileCity"
            value="${escapeAttribute(
                currentUser?.city || ""
            )}"
            placeholder="Ваш город"
        >


        <label>
            Возраст
        </label>

        <input
            id="profileAge"
            type="number"
            min="14"
            max="50"
            value="${escapeAttribute(
                currentUser?.age || ""
            )}"
            placeholder="Ваш возраст"
        >


        <label>
            Username
        </label>

        <input
            id="profileUsername"
            value="${escapeAttribute(
                currentUser?.username || ""
            )}"
            placeholder="@username"
        >

        <button
            class="primary-button"
            onclick="saveProfile()"
        >
            💾 Сохранить
        </button>

    </div>

    ${
        isAdmin
        ? `
        <button
            class="admin-button"
            onclick="
                closeProfile();
                openAdmin();
            "
        >
            ⚙️ Админ-панель
        </button>
        `
        : ""
    }
`;
```

}

function closeProfile() {

```
document
    .getElementById(
        "profileModal"
    )
    ?.classList.add("hidden");
```

}

async function saveProfile() {

```
const first_name =
    document.getElementById(
        "profileName"
    ).value.trim();

const city =
    document.getElementById(
        "profileCity"
    ).value.trim();

const age =
    Number(
        document.getElementById(
            "profileAge"
        ).value
    );

const username =
    document.getElementById(
        "profileUsername"
    ).value.trim();


try {

    const data =
        await api(
            "/api/profile",
            {
                method: "POST",
                body: JSON.stringify({
                    first_name,
                    city,
                    age,
                    username
                })
            }
        );

    currentUser =
        data.user;

    updateHello();

    showToast(
        "Профиль сохранён ✅"
    );

} catch (error) {

    showToast(
        error.message ||
        "Не удалось сохранить профиль"
    );
}
```

}

// ============================================================
// ADMIN
// ============================================================

async function openAdmin() {

```
if (!isAdmin) {
    showToast("Нет доступа");
    return;
}

document
    .getElementById(
        "adminModal"
    )
    .classList.remove("hidden");

await loadAdminStats();
```

}

function closeAdmin() {

```
document
    .getElementById(
        "adminModal"
    )
    ?.classList.add("hidden");
```

}

async function loadAdminStats() {

```
const content =
    document.getElementById(
        "adminContent"
    );

content.innerHTML = `
    <div class="loading">
        Загрузка админ-панели...
    </div>
`;

try {

    const data =
        await api(
            "/api/admin/stats"
        );

    const stats =
        data.stats;

    content.innerHTML = `

        <div class="admin-stats">

            <div class="stat-card">
                <span>👥</span>
                <b>${stats.users}</b>
                <small>Пользователи</small>
            </div>

            <div class="stat-card">
                <span>💼</span>
                <b>${stats.vacancies}</b>
                <small>Вакансии</small>
            </div>

            <div class="stat-card">
                <span>📩</span>
                <b>${stats.applications}</b>
                <small>Отклики</small>
            </div>

        </div>

        <div class="admin-actions">

            <button
                onclick="adminVacancies()"
            >
                💼 Управление вакансиями
            </button>

            <button
                onclick="adminApplications()"
            >
                📩 Все отклики
            </button>

            <button
                onclick="adminCreateVacancy()"
            >
                ➕ Добавить вакансию
            </button>

        </div>
    `;

} catch (error) {

    showError(
        error.message ||
        "Ошибка админ-панели",
        content
    );
}
```

}

// ============================================================
// ADMIN VACANCIES
// ============================================================

async function adminVacancies() {

```
const content =
    document.getElementById(
        "adminContent"
    );

content.innerHTML =
    `<div class="loading">Загрузка...</div>`;

try {

    const data =
        await api(
            "/api/admin/vacancies"
        );

    const list =
        data.vacancies || [];

    content.innerHTML = `

        <div class="admin-page-header">

            <button
                class="back-button"
                onclick="loadAdminStats()"
            >
                ← Назад
            </button>

            <h3>
                💼 Вакансии
            </h3>

            <button
                class="small-primary"
                onclick="adminCreateVacancy()"
            >
                + Добавить
            </button>

        </div>

        ${
            list.length
            ? list.map(vacancy => `
                <div class="admin-vacancy">

                    <div>
                        <h4>
                            ${escapeHtml(
                                vacancy.title
                            )}
                        </h4>

                        <span>
                            ${
                                vacancy.category ||
                                "Без категории"
                            }
                        </span>

                        <span>
                            ${
                                vacancy.active
                                    ? "🟢 Активна"
                                    : "🔴 Скрыта"
                            }
                        </span>
                    </div>

                    <div class="admin-vacancy-buttons">

                        <button
                            onclick="
                                adminToggleVacancy(
                                    ${vacancy.id}
                                )
                            "
                        >
                            ${
                                vacancy.active
                                    ? "Скрыть"
                                    : "Активировать"
                            }
                        </button>

                        <button
                            class="danger-button"
                            onclick="
                                adminDeleteVacancy(
                                    ${vacancy.id}
                                )
                            "
                        >
                            🗑
                        </button>

                    </div>

                </div>
            `).join("")
            : `
                <div class="empty-state">
                    Вакансий нет.
                </div>
            `
        }
    `;

} catch (error) {

    showToast(
        error.message ||
        "Ошибка загрузки вакансий"
    );
}
```

}

async function adminCreateVacancy() {

```
const content =
    document.getElementById(
        "adminContent"
    );

content.innerHTML = `

    <div class="admin-page-header">

        <button
            class="back-button"
            onclick="loadAdminStats()"
        >
            ← Назад
        </button>

        <h3>
            ➕ Новая вакансия
        </h3>

    </div>

    <div class="admin-form">

        <label>
            Название
        </label>

        <input
            id="adminTitle"
            placeholder="Например: Водитель"
        >

        <label>
            Категория
        </label>

        <input
            id="adminCategory"
            placeholder="Водитель, Курьер, Логист..."
        >

        <label>
            Зарплата
        </label>

        <input
            id="adminSalary"
            placeholder="Например: от 5000 ₽ в день"
        >

        <label>
            Описание
        </label>

        <textarea
            id="adminDescription"
            placeholder="Опишите суть работы"
        ></textarea>

        <label>
            Требования
        </label>

        <textarea
            id="adminRequirements"
            placeholder="Требования к кандидату"
        ></textarea>

        <label>
            Контакт
        </label>

        <input
            id="adminContact"
            placeholder="@username или телефон"
        >

        <button
            class="primary-button"
            onclick="createVacancy()"
        >
            💾 Создать вакансию
        </button>

    </div>
`;
```

}

async function createVacancy() {

```
const title =
    document.getElementById(
        "adminTitle"
    ).value.trim();

const category =
    document.getElementById(
        "adminCategory"
    ).value.trim();

const salary =
    document.getElementById(
        "adminSalary"
    ).value.trim();

const description =
    document.getElementById(
        "adminDescription"
    ).value.trim();

const requirements =
    document.getElementById(
        "adminRequirements"
    ).value.trim();

const contact =
    document.getElementById(
        "adminContact"
    ).value.trim();


if (title.length < 2) {
    showToast(
        "Введите название вакансии"
    );
    return;
}


try {

    const data =
        await api(
            "/api/admin/vacancy",
            {
                method: "POST",
                body: JSON.stringify({
                    title,
                    category,
                    salary,
                    description,
                    requirements,
                    contact
                })
            }
        );

    showToast(
        `Вакансия №${data.vacancy_id} создана ✅`
    );

    await loadCategories();

    await adminVacancies();

} catch (error) {

    showToast(
        error.message ||
        "Не удалось создать вакансию"
    );
}
```

}

async function adminToggleVacancy(id) {

```
try {

    await api(
        `/api/admin/vacancy/${id}/toggle`,
        {
            method: "POST"
        }
    );

    await loadCategories();
    await adminVacancies();

} catch (error) {

    showToast(error.message);
}
```

}

async function adminDeleteVacancy(id) {

```
const confirmed =
    confirm(
        "Удалить эту вакансию?"
    );

if (!confirmed) return;

try {

    await api(
        `/api/admin/vacancy/${id}`,
        {
            method: "DELETE"
        }
    );

    await loadCategories();
    await adminVacancies();

    showToast(
        "Вакансия удалена"
    );

} catch (error) {

    showToast(
        error.message ||
        "Ошибка удаления"
    );
}
```

}

// ============================================================
// ADMIN APPLICATIONS
// ============================================================

async function adminApplications() {

```
const content =
    document.getElementById(
        "adminContent"
    );

content.innerHTML =
    `<div class="loading">Загрузка...</div>`;

try {

    const data =
        await api(
            "/api/admin/applications"
        );

    const applications =
        data.applications || [];

    content.innerHTML = `

        <div class="admin-page-header">

            <button
                class="back-button"
                onclick="loadAdminStats()"
            >
                ← Назад
            </button>

            <h3>
                📩 Отклики
            </h3>

        </div>

        ${
            applications.length
            ? applications.map(app => `

                <div class="admin-application">

                    <div class="application-header">

                        <h4>
                            ${escapeHtml(
                                app.title ||
                                "Вакансия"
                            )}
                        </h4>

                        <span class="status new">
                            ${
                                escapeHtml(
                                    app.status ||
                                    "new"
                                )
                            }
                        </span>

                    </div>

                    <p>
                        👤
                        ${escapeHtml(
                            app.name ||
                            "—"
                        )}
                    </p>

                    <p>
                        🎂
                        ${app.age || "—"}
                    </p>

                    <p>
                        🏙️
                        ${escapeHtml(
                            app.city ||
                            "—"
                        )}
                    </p>

                    <p>
                        📞
                        ${escapeHtml(
                            app.contact ||
                            "—"
                        )}
                    </p>

                    <div class="application-message">
                        📝
                        ${nl2br(
                            escapeHtml(
                                app.message ||
                                ""
                            )
                        )}
                    </div>

                    <small>
                        ${formatDate(
                            app.created_at
                        )}
                    </small>

                    <div class="telegram-id">
                        Telegram ID:
                        ${app.user_id || "—"}
                    </div>

                </div>

            `).join("")
            : `
                <div class="empty-state">
                    Откликов пока нет.
                </div>
            `
        }
    `;

} catch (error) {

    showToast(
        error.message ||
        "Ошибка загрузки откликов"
    );
}
```

}

// ============================================================
// HOME
// ============================================================

function showHome() {

```
setActiveNav(0);

loadVacancies();
```

}

function renderVacancyCollection(
list,
title,
emptyText
) {

```
const content =
    document.getElementById(
        "content"
    );

if (!list.length) {

    content.innerHTML = `
        <div class="empty-state">

            <div class="empty-icon">
                ❤️
            </div>

            <h3>
                ${escapeHtml(title)}
            </h3>

            <p>
                ${escapeHtml(emptyText)}
            </p>

        </div>
    `;

    return;
}

content.innerHTML = `

    <div class="page-title">
        ${escapeHtml(title)}
    </div>

    <div class="vacancies-list">

        ${list
            .map(renderVacancyCard)
            .join("")}

    </div>
`;
```

}

// ============================================================
// SEARCH
// ============================================================

function setupSearch() {

```
const input =
    document.getElementById(
        "searchInput"
    );

if (!input) return;

let timer;

input.addEventListener(
    "input",
    event => {

        currentSearch =
            event.target.value.trim();

        clearTimeout(timer);

        timer = setTimeout(
            () => loadVacancies(),
            350
        );
    }
);
```

}

function clearSearch() {

```
const input =
    document.getElementById(
        "searchInput"
    );

if (input) {
    input.value = "";
}

currentSearch = "";

loadVacancies();
```

}

// ============================================================
// NAVIGATION
// ============================================================

function setActiveNav(index) {

```
document
    .querySelectorAll(
        ".nav-item"
    )
    .forEach(
        (item, i) => {
            item.classList.toggle(
                "active",
                i === index
            );
        }
    );
```

}

// ============================================================
// UI
// ============================================================

function showLoading(
container = document.getElementById("content")
) {

```
if (!container) return;

container.innerHTML = `
    <div class="loading">
        <div class="spinner"></div>
        <span>Загрузка...</span>
    </div>
`;
```

}

function showError(
message,
container = document.getElementById("content")
) {

```
if (!container) return;

container.innerHTML = `
    <div class="error-state">

        <div class="error-icon">
            ⚠️
        </div>

        <h3>
            Ошибка
        </h3>

        <p>
            ${escapeHtml(
                message || "Неизвестная ошибка"
            )}
        </p>

        <button
            class="primary-button"
            onclick="loadVacancies()"
        >
            Повторить
        </button>

    </div>
`;
```

}

function showToast(message) {

```
let toast =
    document.getElementById(
        "toast"
    );

if (!toast) {

    toast =
        document.createElement(
            "div"
        );

    toast.id = "toast";
    toast.className = "toast";

    document.body.appendChild(
        toast
    );
}

toast.textContent =
    message;

toast.classList.add(
    "show"
);

clearTimeout(
    toast._timer
);

toast._timer =
    setTimeout(
        () => {
            toast.classList.remove(
                "show"
            );
        },
        2800
    );
```

}

// ============================================================
// MODALS
// ============================================================

document.addEventListener(
"click",
event => {

```
    if (
        event.target.classList.contains(
            "modal"
        )
    ) {

        event.target.classList.add(
            "hidden"
        );
    }
}
```

);

// ============================================================
// TELEGRAM THEME
// ============================================================

function applyTelegramTheme() {

```
if (!tg) return;

const root =
    document.documentElement;

const theme =
    tg.themeParams || {};

if (theme.bg_color) {
    root.style.setProperty(
        "--tg-bg",
        theme.bg_color
    );
}

if (theme.text_color) {
    root.style.setProperty(
        "--tg-text",
        theme.text_color
    );
}

if (theme.hint_color) {
    root.style.setProperty(
        "--tg-hint",
        theme.hint_color
    );
}

if (theme.button_color) {
    root.style.setProperty(
        "--tg-button",
        theme.button_color
    );
}

if (theme.button_text_color) {
    root.style.setProperty(
        "--tg-button-text",
        theme.button_text_color
    );
}

if (theme.secondary_bg_color) {
    root.style.setProperty(
        "--tg-secondary",
        theme.secondary_bg_color
    );
}
```

}

// ============================================================
// HELPERS
// ============================================================

function escapeHtml(value) {

```
return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
```

}

function escapeAttribute(value) {

```
return escapeHtml(value);
```

}

function nl2br(value) {

```
return String(value)
    .replace(/\n/g, "<br>");
```

}

function truncate(
text,
maxLength
) {

```
text = String(text || "");

if (text.length <= maxLength) {
    return text;
}

return (
    text.substring(
        0,
        maxLength
    ) + "..."
);
```

}

function formatDate(value) {

```
if (!value) return "";

const date =
    new Date(value);

if (Number.isNaN(
    date.getTime()
)) {
    return value;
}

return date.toLocaleString(
    "ru-RU",
    {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }
);
```

}

function getStatus(status) {

```
switch (
    String(status || "").toLowerCase()
) {

    case "new":
        return {
            text: "Новый",
            class: "new"
        };

    case "accepted":
        return {
            text: "Принят",
            class: "accepted"
        };

    case "rejected":
        return {
            text: "Отклонён",
            class: "rejected"
        };

    default:
        return {
            text:
                status || "На рассмотрении",
            class: "pending"
        };
}
```

}

// ============================================================
// GLOBAL EXPORTS
// ============================================================

window.showHome =
showHome;

window.showFavorites =
showFavorites;

window.showApplications =
showApplications;

window.openProfile =
openProfile;

window.closeProfile =
closeProfile;

window.openAdmin =
openAdmin;

window.closeAdmin =
closeAdmin;

window.selectCategory =
selectCategory;

window.clearSearch =
clearSearch;

window.openVacancy =
openVacancy;

window.closeModal =
closeModal;

window.openApplication =
openApplication;

window.closeApplication =
closeApplication;

window.sendApplication =
sendApplication;

window.toggleFavorite =
toggleFavorite;

window.saveProfile =
saveProfile;

window.adminVacancies =
adminVacancies;

window.adminApplications =
adminApplications;

window.adminCreateVacancy =
adminCreateVacancy;

window.createVacancy =
createVacancy;

window.adminToggleVacancy =
adminToggleVacancy;

window.adminDeleteVacancy =
adminDeleteVacancy;
