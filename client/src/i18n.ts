import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const LANGUAGE_KEY = 'roamlet-language';
export function detectLanguage(): 'en' | 'ru' {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved === 'en' || saved === 'ru') return saved;
  } catch {
    /* Storage can be disabled by browser privacy settings. */
  }
  return typeof navigator !== 'undefined' &&
    (navigator.languages?.[0] || navigator.language)?.toLowerCase().startsWith('ru')
    ? 'ru'
    : 'en';
}

export const russian: Record<string, string> = {
  Language: 'Язык',
  'Set VITE_TILE_ATTRIBUTION to the tile provider’s required credits.':
    'Задайте VITE_TILE_ATTRIBUTION с указанием авторства, требуемым провайдером тайлов.',
  'Roamlet home': 'Главная Roamlet',
  'A little planning. A lot of possibility.': 'Немного планирования. Множество возможностей.',
  'Main navigation': 'Главная навигация',
  'My routes': 'Мои маршруты',
  'Help and data sources': 'Помощь и источники данных',
  'New route': 'Новый маршрут',
  'Route planner': 'Планировщик маршрутов',
  'Your route': 'Ваш маршрут',
  'Plan your next adventure': 'Спланируйте новое приключение',
  'MAKE TIME FOR OUTSIDE': 'НАЙДИТЕ ВРЕМЯ ДЛЯ ПРИРОДЫ',
  'Where shall we go?': 'Куда отправимся?',
  'Find your own way, one stop at a time.': 'Найдите свой путь, остановка за остановкой.',
  'Edit route name': 'Изменить название маршрута',
  'Activity profile': 'Вид активности',
  Cycling: 'Велосипед',
  Hiking: 'Пеший поход',
  cycling: 'велосипедный',
  hiking: 'пешеходный',
  'Route style': 'Тип маршрута',
  'Point to point': 'Из точки в точку',
  'Round trip': 'Кольцевой маршрут',
  'Search places or coordinates': 'Поиск мест или координат',
  'Find a replacement stop…': 'Найдите новую остановку…',
  'Search places or coordinates…': 'Найдите место или введите координаты…',
  Search: 'Поиск',
  'Search a place, enter latitude, longitude, or click the map.':
    'Найдите место, введите широту и долготу или нажмите на карту.',
  'Cancel replacing stop': 'Отменить замену остановки',
  'Starting point': 'Начальная точка',
  'Your stops': 'Ваши остановки',
  Reverse: 'В обратном порядке',
  'A good route starts somewhere': 'Каждый маршрут с чего-то начинается',
  'Choose your first stop on the map or search above.':
    'Выберите первую остановку на карте или найдите её выше.',
  Start: 'Старт',
  Finish: 'Финиш',
  Via: 'Через',
  '· click to replace': '· нажмите для замены',
  'Move stop {{number}} up': 'Переместить остановку {{number}} вверх',
  'Move stop {{number}} down': 'Переместить остановку {{number}} вниз',
  'Remove stop {{number}}': 'Удалить остановку {{number}}',
  'Add a stop': 'Добавить остановку',
  'or click the map': 'или нажмите на карту',
  'Target distance': 'Желаемая длина',
  km: 'км',
  m: 'м',
  h: 'ч',
  min: 'мин',
  metres: 'метры',
  'Target loop distance': 'Желаемая длина кольцевого маршрута',
  'Two calculated possibilities. Actual distances vary with the path network.':
    'Два рассчитанных варианта. Длина зависит от сети дорог и троп.',
  'Finding your way…': 'Ищем ваш путь…',
  'Discover round trips': 'Найти кольцевые маршруты',
  Option: 'Вариант',
  'Original GPX geometry': 'Исходная геометрия GPX',
  'Saved route, ready to explore': 'Сохранённый маршрут готов к путешествию',
  'Save and export without changing any points.': 'Сохраняйте и экспортируйте без изменения точек.',
  'Edit waypoints': 'Изменить точки',
  'Calculating a real': 'Рассчитываем',
  'route…': 'маршрут…',
  'Dismiss notification': 'Закрыть уведомление',
  'The routing proxy is unreachable. Map, GPX, and saved routes still work.':
    'Прокси маршрутизации недоступен. Карта, GPX и сохранённые маршруты работают.',
  'Online routing is not configured on the server. Map, GPX, and saved routes still work.':
    'Онлайн-маршрутизация не настроена на сервере. Карта, GPX и сохранённые маршруты работают.',
  Setup: 'Настройка',
  'LESS SCROLLING. MORE STROLLING.': 'МЕНЬШЕ ЭКРАНА. БОЛЬШЕ ПРОГУЛОК.',
  'Start small. Take the scenic way.': 'Начните с малого. Выберите живописный путь.',
  'Make a route that feels like you.': 'Создайте маршрут по душе.',
  'Save route': 'Сохранить маршрут',
  'Export GPX': 'Экспорт GPX',
  'Import GPX': 'Импорт GPX',
  'or drop a file anywhere': 'или перетащите файл сюда',
  'Import GPX file': 'Импорт файла GPX',
  'Save your adventure': 'Сохраните приключение',
  'Keep it on this device. Give it a name you’ll remember.':
    'Сохраните на этом устройстве. Придумайте запоминающееся название.',
  'Route name': 'Название маршрута',
  'Sunday’s scenic escape': 'Воскресная прогулка',
  Description: 'Описание',
  '(optional)': '(необязательно)',
  'A note for your future self…': 'Заметка на будущее…',
  Cancel: 'Отмена',
  'Saving…': 'Сохраняем…',
  'Save to library': 'Сохранить в библиотеку',
  'A few helpful things': 'Полезная информация',
  'Connect routing & search': 'Подключение маршрутизации и поиска',
  'For deployment administrators: create a key at': 'Администраторам: создайте ключ на сайте',
  '. Set': '. Задайте',
  'in the proxy’s server environment and restart the proxy. The browser never receives this key; it submits routing requests through the same-origin API.':
    'в окружении сервера прокси и перезапустите его. Ключ не передаётся в браузер; запросы маршрутизации идут через API на том же домене.',
  'Your route, your device': 'Ваш маршрут, ваше устройство',
  'Routes stay in your browser’s IndexedDB. No account or backend is needed. Export GPX backups before clearing browser data.':
    'Маршруты хранятся в IndexedDB браузера. Аккаунт и сервер не нужны. Экспортируйте резервные копии GPX перед очисткой данных браузера.',
  'Take it with you': 'Возьмите маршрут с собой',
  'Export a GPX, then use the file-import feature supported by your GPS device or app. Check the official Strava or Komoot help for GPX import availability. There is no direct publishing integration.':
    'Экспортируйте GPX и импортируйте файл в GPS-устройство или приложение. Возможность импорта GPX уточняйте в справке Strava или Komoot. Прямой публикации нет.',
  'Real data, honest limits': 'Реальные данные и честные ограничения',
  'Cycling uses ORS general cycling, not a dedicated gravel profile. Hiking uses foot-hiking. Access and surface quality depend on mapped data; always check conditions. Time and terrain elevations are estimates. Loops use ORS round-trip requests and may differ from the target distance.':
    'Для велосипеда используется общий профиль ORS, а не специальный гравийный. Для походов — foot-hiking. Доступность и покрытие зависят от картографических данных; проверяйте условия. Время и высоты приблизительны. Кольцевые маршруты ORS могут отличаться от желаемой длины.',
  'Data & attribution': 'Данные и авторство',
  'Map data ©': 'Данные карты ©',
  'OpenStreetMap contributors': 'участники OpenStreetMap',
  '(ODbL). Default OSM tiles are for low-traffic development; use a suitable hosted provider for production. No map tiles are downloaded for offline use. Routing & place search ©':
    '(ODbL). Стандартные тайлы OSM предназначены для разработки с низкой нагрузкой; для эксплуатации выберите подходящего провайдера. Тайлы не загружаются для офлайн-использования. Маршрутизация и поиск мест ©',
  ', with OSM data.': ', с данными OSM.',
  'The proxy forwards the places you search and route points you submit to the routing provider. Your saved local library is not uploaded. Private provider credentials stay on the server. The saved library and GPX work offline after the app shell has been cached in a production build.':
    'Прокси передаёт провайдеру запросы поиска и точки маршрутов. Локальная библиотека не загружается на сервер. Секретные ключи остаются на сервере. Библиотека и GPX работают офлайн после кеширования оболочки приложения в производственной сборке.',
  'Close dialog': 'Закрыть диалог',
  'Interactive route map': 'Интерактивная карта маршрута',
  'Dismiss map notice': 'Закрыть уведомление карты',
  'Loading your map…': 'Загружаем карту…',
  'YOUR NEXT WAY OUT': 'ВАШ ПУТЬ К ПРИКЛЮЧЕНИЯМ',
  'Use my location': 'Моё местоположение',
  'Fit route': 'Показать весь маршрут',
  'Zoom in': 'Приблизить',
  'Zoom out': 'Отдалить',
  'Toggle attribution': 'Показать авторство',
  Map: 'Карта',
  'Click the map to add a stop. Drag pins to refine.':
    'Нажмите на карту, чтобы добавить остановку. Перетаскивайте точки для уточнения.',
  'Report a map issue ↗': 'Сообщить об ошибке карты ↗',
  ' — drag to reposition': ' — перетащите для перемещения',
  'Route statistics': 'Статистика маршрута',
  'Route overview': 'Обзор маршрута',
  'Imported GPX': 'Импортированный GPX',
  'Ready when you are': 'Готовы, когда вы готовы',
  Distance: 'Расстояние',
  'Est. moving time': 'Время в пути (примерно)',
  'Elevation gain': 'Набор высоты',
  'Elevation loss': 'Спуск',
  Unavailable: 'Недоступно',
  'Elevation profile': 'Профиль высот',
  'No elevation data': 'Нет данных о высоте',
  'Elevation from {{minimum}} to {{maximum}} metres': 'Высота от {{minimum}} до {{maximum}} метров',
  'This route has no complete elevation data.': 'Для этого маршрута нет полных данных о высоте.',
  'Your route’s ups and downs will appear here.': 'Здесь появятся подъёмы и спуски маршрута.',
  'General cycling': 'Обычная велопрогулка',
  '· Time is an estimate, excluding stops. Surface information unavailable.':
    '· Время приблизительное, без остановок. Данные о покрытии недоступны.',
  'Elevation: provider terrain model, not a survey.':
    'Высоты: модель рельефа провайдера, не геодезическая съёмка.',
  'Elevation: GPX file, when available.': 'Высоты: из файла GPX, если доступны.',
  'Your route library': 'Библиотека маршрутов',
  'Good routes are worth keeping. Saved on this device, no account needed.':
    'Хорошие маршруты стоит сохранить. На этом устройстве, без аккаунта.',
  'Search saved routes': 'Поиск сохранённых маршрутов',
  'Find a saved route…': 'Найдите сохранённый маршрут…',
  'Opening your library…': 'Открываем библиотеку…',
  'Your next adventure belongs here': 'Здесь будет ваше новое приключение',
  'Plan a route or import a GPX, then save it for later.':
    'Спланируйте маршрут или импортируйте GPX, затем сохраните его.',
  'No routes match your search.': 'По вашему запросу маршрутов нет.',
  '· Updated': '· Обновлён',
  'Edit {{name}}': 'Изменить {{name}}',
  'Duplicate {{name}}': 'Создать копию {{name}}',
  'Delete {{name}}': 'Удалить {{name}}',
  'Edit route details': 'Изменить сведения о маршруте',
  'Save changes': 'Сохранить изменения',
  Delete: 'Удалить',
  'from this device? This cannot be undone.': 'с этого устройства? Это действие нельзя отменить.',
  'Keep route': 'Оставить маршрут',
  'Delete route': 'Удалить маршрут',
  'Your browser stores these routes in IndexedDB. Export important routes as GPX before clearing browser data.':
    'Маршруты хранятся в IndexedDB браузера. Экспортируйте важные маршруты в GPX перед очисткой данных браузера.',
  'Untitled adventure': 'Приключение без названия',
  'Imported start': 'Импортированный старт',
  'Imported finish': 'Импортированный финиш',
  'Loop start': 'Начало кольца',
  'Return to start': 'Возвращение к старту',
  'Loop stop {{number}}': 'Остановка кольца {{number}}',
  'Track start': 'Начало трека',
  'Track finish': 'Конец трека',
  Waypoint: 'Путевая точка',
  'Imported route': 'Импортированный маршрут',
  '(copy)': '(копия)',
  'Leave this route?': 'Покинуть этот маршрут?',
  'Your unsaved changes will be lost. Save the route first if you want to keep it.':
    'Несохранённые изменения будут потеряны. Сначала сохраните маршрут, если хотите оставить его.',
  'Discard changes': 'Отбросить изменения',
  'Recalculate for cycling?': 'Пересчитать для велосипеда?',
  'Recalculate for hiking?': 'Пересчитать для пешего похода?',
  'This changes the routing profile and may change the route geometry. Save or export the original if you want to keep it.':
    'Профиль маршрутизации изменится, что может изменить геометрию. Сохраните или экспортируйте исходный маршрут.',
  'Recalculate route': 'Пересчитать маршрут',
  'Convert GPX to an editable route?': 'Преобразовать GPX в редактируемый маршрут?',
  'Edit this route?': 'Изменить этот маршрут?',
  'A fresh road/path route will be calculated between the track’s start and finish. This replaces original GPX geometry; export or save the original first. Disconnected tracks may not be routable.':
    'Между стартом и финишем будет рассчитан новый маршрут по дорогам и тропам. Он заменит геометрию GPX; сначала сохраните или экспортируйте оригинал. Разрозненные треки могут не подходить для маршрутизации.',
  'Your saved waypoints will be routed again. Current map data may produce a different route.':
    'Маршрут между сохранёнными точками будет пересчитан. Текущие данные карты могут дать другой результат.',
  'Something went wrong. Please try again.': 'Что-то пошло не так. Попробуйте ещё раз.',
  'A route supports up to 50 stops. Remove a stop before adding another.':
    'Маршрут может содержать до 50 остановок. Удалите остановку перед добавлением новой.',
  'Route saved on this device. Your next adventure is ready.':
    'Маршрут сохранён на этом устройстве. Ваше новое приключение готово.',
  'GPX exported. Import it through your GPS device or compatible app’s GPX upload workflow.':
    'GPX экспортирован. Импортируйте файл в GPS-устройство или совместимое приложение.',
  'Choose a GPX file smaller than 10 MiB.': 'Выберите файл GPX размером менее 10 МиБ.',
  'GPX imported. Original points and track segments are preserved. Save it to keep it on this device.':
    'GPX импортирован. Исходные точки и сегменты трека сохранены. Сохраните маршрут на этом устройстве.',
  'Use latitude −90 to 90 and longitude −180 to 180.':
    'Укажите широту от −90 до 90 и долготу от −180 до 180.',
  'No places found. Try a town, address, or latitude, longitude.':
    'Места не найдены. Попробуйте город, адрес или широту и долготу.',
  'This GPX contains only isolated points. They are preserved for saving and export; start a new route to plan between locations.':
    'В GPX только отдельные точки. Они сохранены для экспорта; начните новый маршрут для планирования между местами.',
  'Choose a starting point on the map or with search first.':
    'Сначала выберите начальную точку на карте или через поиск.',
  'This browser cannot render the interactive map. Enable WebGL or try another browser. GPX and saved routes remain available.':
    'Браузер не может отобразить интерактивную карту. Включите WebGL или используйте другой браузер. GPX и сохранённые маршруты доступны.',
  'Your browser cannot save the last map view. The map still works, but its position may reset after reloading.':
    'Браузер не может сохранить положение карты. Карта работает, но после перезагрузки положение может сброситься.',
  'Some map tiles could not load. Check your connection or configured tile provider. No offline map is stored.':
    'Некоторые тайлы карты не загрузились. Проверьте соединение или провайдера тайлов. Офлайн-карта не хранится.',
  'Location is not supported in this browser. Search for a place or click the map instead.':
    'Браузер не поддерживает определение местоположения. Найдите место или нажмите на карту.',
  'Location permission was denied or your position is unavailable. Search for a place or click the map instead.':
    'Нет разрешения на геолокацию или местоположение недоступно. Найдите место или нажмите на карту.',
  'Your library could not be loaded.': 'Не удалось загрузить библиотеку.',
  'Could not update your library.': 'Не удалось обновить библиотеку.',
  'Unable to load route data.': 'Не удалось загрузить данные маршрутов.',
  'Unable to save route data.': 'Не удалось сохранить данные маршрута.',
  'Unable to delete route data.': 'Не удалось удалить данные маршрута.',
  'Unable to duplicate route data.': 'Не удалось создать копию маршрута.',
  'Invalid route data.': 'Некорректные данные маршрута.',
  'Invalid route waypoint.': 'Некорректная точка маршрута.',
  'Invalid route statistics.': 'Некорректная статистика маршрута.',
  'Invalid route id.': 'Некорректный идентификатор маршрута.',
  'Invalid coordinate: expected [longitude, latitude, optional elevation].':
    'Некорректные координаты: ожидаются долгота, широта и необязательная высота.',
  'Unsupported activity.': 'Неподдерживаемая активность.',
  'The routing proxy returned an invalid health response.':
    'Прокси маршрутизации вернул некорректный ответ о состоянии.',
  'The service returned an invalid response.': 'Сервис вернул некорректный ответ.',
  'Routing requests must use the local API proxy.':
    'Запросы маршрутизации должны идти через локальный API-прокси.',
  'Routing is not configured on the server. Ask the deployment administrator to set ORS_API_KEY. GPX and your library still work.':
    'Маршрутизация не настроена на сервере. Попросите администратора задать ORS_API_KEY. GPX и библиотека работают.',
  'The routing request was rejected. Check server configuration and provider account permissions.':
    'Запрос маршрутизации отклонён. Проверьте настройки сервера и права аккаунта провайдера.',
  'Routing quota reached. Wait a moment or check your provider account limits.':
    'Квота маршрутизации исчерпана. Подождите или проверьте лимиты аккаунта провайдера.',
  'Routing quota reached.': 'Квота маршрутизации исчерпана.',
  'The routing service is unavailable. Try again later; your saved routes are safe.':
    'Сервис маршрутизации недоступен. Попробуйте позже; сохранённые маршруты в безопасности.',
  'No route or location found (service {{status}}). Try points closer to accessible roads or trails, or a shorter route.':
    'Маршрут или место не найдены (сервис {{status}}). Выберите точки ближе к доступным дорогам и тропам или более короткий маршрут.',
  'The service took too long to respond. Please try again.':
    'Сервис не ответил вовремя. Попробуйте ещё раз.',
  'Cannot reach the service. Check your internet connection and provider URL.':
    'Сервис недоступен. Проверьте интернет-соединение и адрес провайдера.',
  'Routing must use the same-origin /api proxy.':
    'Маршрутизация должна использовать /api-прокси на том же домене.',
  'Route locations must contain valid longitude and latitude.':
    'Точки маршрута должны содержать корректные долготу и широту.',
  'No route was returned. Try a different location.':
    'Сервис не вернул маршрут. Попробуйте другое место.',
  'The service returned invalid route geometry.': 'Сервис вернул некорректную геометрию маршрута.',
  'The service returned invalid route statistics.':
    'Сервис вернул некорректную статистику маршрута.',
  'Choose between 2 and 50 route points.': 'Выберите от 2 до 50 точек маршрута.',
  'Choose a loop distance between 2 and 100 km.': 'Выберите длину кольца от 2 до 100 км.',
  'The service did not return a closed loop. Try a different start location.':
    'Сервис не вернул замкнутый маршрут. Попробуйте другую начальную точку.',
  'Enter a place or address between 3 and 200 characters.':
    'Введите название места или адрес длиной от 3 до 200 символов.',
  'The search service returned invalid locations.': 'Сервис поиска вернул некорректные места.',
  'The search service returned an invalid location.': 'Сервис поиска вернул некорректное место.',
  'Invalid GPX: undeclared XML entity.': 'Некорректный GPX: необъявленная XML-сущность.',
  'Invalid GPX XML character reference.': 'Некорректная ссылка на символ XML в GPX.',
  'Invalid GPX {{field}}: expected text.': 'Некорректный GPX: в поле «{{field}}» ожидается текст.',
  'Invalid GPX {{field}}.': 'Некорректное поле GPX: {{field}}.',
  latitude: 'широта',
  longitude: 'долгота',
  elevation: 'высота',
  name: 'название',
  desc: 'описание',
  'GPX coordinate is out of bounds.': 'Координаты GPX выходят за допустимые пределы.',
  'GPX file exceeds the 10 MiB limit.': 'Размер GPX превышает 10 МиБ.',
  'GPX file is empty.': 'Файл GPX пуст.',
  'GPX DTDs and entity declarations are not allowed.':
    'DTD и объявления XML-сущностей в GPX запрещены.',
  'GPX nesting exceeds the safe limit.': 'Вложенность GPX превышает безопасный предел.',
  'Malformed GPX XML.': 'Некорректный XML в GPX.',
  'Invalid GPX: expected a gpx root element.': 'Некорректный GPX: ожидается корневой элемент gpx.',
  'GPX exceeds the 100,000 point limit.': 'GPX превышает лимит в 100 000 точек.',
  'GPX contains no track, route, or waypoint points.':
    'GPX не содержит точек трека, маршрута или путевых точек.',
  'Invalid text for GPX XML.': 'Недопустимый текст для XML GPX.',
  'Cannot export an empty GPX route.': 'Нельзя экспортировать пустой маршрут GPX.',
};

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: Object.fromEntries(Object.keys(russian).map((key) => [key, key])) },
    ru: { translation: russian },
  },
  lng: detectLanguage(),
  fallbackLng: 'en',
  supportedLngs: ['en', 'ru'],
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  initImmediate: false,
  showSupportNotice: false,
});
function synchronizeLanguage(language: string) {
  const normalized = language.startsWith('ru') ? 'ru' : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = normalized;
  try {
    localStorage.setItem(LANGUAGE_KEY, normalized);
  } catch {
    /* Language switching also works without persistence. */
  }
}
i18n.on('languageChanged', synchronizeLanguage);
synchronizeLanguage(i18n.language);
export const locale = () => (i18n.resolvedLanguage === 'ru' ? 'ru-RU' : 'en-US');
export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(locale(), options).format(value);

// Keep domain errors in their original form so active notices can follow language changes.
export function translateMessage(message: string): string {
  if (i18n.exists(message)) return i18n.t(message);
  const status = message.match(/^No route or location found \(service (\d+)\)\./);
  if (status)
    return i18n.t(
      'No route or location found (service {{status}}). Try points closer to accessible roads or trails, or a shorter route.',
      { status: status[1] },
    );
  if (message.startsWith('Malformed GPX XML:')) return i18n.t('Malformed GPX XML.');
  const field = message.match(/^Invalid GPX (.+?)(: expected text\.|\.)$/);
  if (field)
    return i18n.t(
      field[2].startsWith(':') ? 'Invalid GPX {{field}}: expected text.' : 'Invalid GPX {{field}}.',
      { field: i18n.t(field[1]) },
    );
  return i18n.resolvedLanguage === 'ru'
    ? i18n.t('Something went wrong. Please try again.')
    : message;
}
export default i18n;
