using System;
using System.Collections;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace RealmOfAshes.Net
{
    /// <summary>
    /// HTTP-часть сессии: вход, список персонажей, heartbeat.
    /// Маршруты и заголовки описаны в docs/wiki/AUTH_AND_CHARACTERS.md.
    ///
    /// Пароль здесь только проходит транзитом в POST /api/auth/login и нигде не
    /// сохраняется. Долгоживущий секрет — token, он живёт в памяти процесса.
    /// В PlayerPrefs пишется только deviceId: он не даёт доступа к аккаунту.
    /// </summary>
    public sealed class RoaAuthClient
    {
        private const string DeviceIdPrefsKey = "roa.deviceId";

        private readonly string _baseUrl;

        public string Token { get; private set; } = string.Empty;
        public string DeviceId { get; private set; }
        public string ClientInstanceId { get; private set; }
        public string DeviceType { get { return Application.isMobilePlatform ? "mobile" : "desktop"; } }
        public string ControlType { get { return Application.isMobilePlatform ? "touch" : "keyboard_mouse"; } }
        public IReadOnlyList<CharacterSummary> Characters { get; private set; } = new List<CharacterSummary>();

        public bool IsAuthenticated => !string.IsNullOrEmpty(Token);

        public RoaAuthClient(string baseUrl)
        {
            _baseUrl = (baseUrl ?? string.Empty).TrimEnd('/');
            DeviceId = LoadOrCreateDeviceId();

            // Уникален для запуска процесса. Сервер по нему отличает вкладки/копии
            // клиента одного устройства и корректно ведёт lease персонажа.
            ClientInstanceId = Guid.NewGuid().ToString("N");
        }

        private static string LoadOrCreateDeviceId()
        {
            string stored = PlayerPrefs.GetString(DeviceIdPrefsKey, string.Empty);
            if (!string.IsNullOrEmpty(stored)) return stored;

            string created = Guid.NewGuid().ToString("N");
            PlayerPrefs.SetString(DeviceIdPrefsKey, created);
            PlayerPrefs.Save();
            return created;
        }

        /// <summary>
        /// POST /api/auth/guest — «Начать сразу» web (handleQuickStart, 01:1018):
        /// гостевой профиль привязан к deviceId (заголовок X-Device-Id), пароль не
        /// нужен; сервер возвращает токен и персонажей гостя.
        /// </summary>
        public IEnumerator Guest(Action<bool, string> onDone)
        {
            using (UnityWebRequest request = MakeJsonRequest("/api/auth/guest", "POST", "{}"))
            {
                yield return request.SendWebRequest();

                LoginResponse parsed = null;
                try
                {
                    if (!string.IsNullOrEmpty(request.downloadHandler.text))
                        parsed = JsonConvert.DeserializeObject<LoginResponse>(request.downloadHandler.text);
                }
                catch (JsonException error)
                {
                    onDone?.Invoke(false, "Сервер вернул некорректный JSON: " + error.Message);
                    yield break;
                }

                if (request.result != UnityWebRequest.Result.Success)
                {
                    string message = parsed != null && !string.IsNullOrEmpty(parsed.Error)
                        ? parsed.Error
                        : "Не удалось начать игру без регистрации: " + request.error;
                    onDone?.Invoke(false, message);
                    yield break;
                }

                if (parsed == null || !parsed.Ok || string.IsNullOrEmpty(parsed.Token))
                {
                    onDone?.Invoke(false, parsed?.Error ?? "Сервер не выдал гостевой токен.");
                    yield break;
                }

                Token = parsed.Token;
                Characters = parsed.Characters ?? new List<CharacterSummary>();
                onDone?.Invoke(true, null);
            }
        }

        /// <summary>
        /// POST /api/auth/login. onDone получает (успех, текст ошибки).
        /// Сервер отвечает 401 на неверную пару, 409 если аккаунт уже открыт
        /// на другом устройстве, 503 при перегрузке очереди PBKDF2.
        /// </summary>
        public IEnumerator Login(string login, string password, Action<bool, string> onDone)
        {
            string body = JsonConvert.SerializeObject(new LoginRequest { Login = login, Password = password });

            using (UnityWebRequest request = MakeJsonRequest("/api/auth/login", "POST", body))
            {
                yield return request.SendWebRequest();

                LoginResponse parsed = null;
                try
                {
                    if (!string.IsNullOrEmpty(request.downloadHandler.text))
                        parsed = JsonConvert.DeserializeObject<LoginResponse>(request.downloadHandler.text);
                }
                catch (JsonException error)
                {
                    onDone?.Invoke(false, "Сервер вернул некорректный JSON: " + error.Message);
                    yield break;
                }

                if (request.result != UnityWebRequest.Result.Success)
                {
                    // Сообщения сервера уже на русском и пригодны для показа игроку.
                    string message = parsed != null && !string.IsNullOrEmpty(parsed.Error)
                        ? parsed.Error
                        : "Не удалось связаться с сервером: " + request.error;
                    onDone?.Invoke(false, message);
                    yield break;
                }

                if (parsed == null || !parsed.Ok || string.IsNullOrEmpty(parsed.Token))
                {
                    onDone?.Invoke(false, parsed?.Error ?? "Сервер не выдал токен сессии.");
                    yield break;
                }

                Token = parsed.Token;
                Characters = parsed.Characters ?? new List<CharacterSummary>();
                onDone?.Invoke(true, null);
            }
        }

        public IEnumerator Register(string login, string email, string password, Action<bool, string> onDone)
        {
            string body = new JObject
            {
                ["login"] = login ?? string.Empty,
                ["email"] = email ?? string.Empty,
                ["password"] = password ?? string.Empty
            }.ToString(Formatting.None);

            using (UnityWebRequest request = MakeJsonRequest("/api/auth/register", "POST", body))
            {
                yield return request.SendWebRequest();
                LoginResponse parsed = null;
                try
                {
                    if (!string.IsNullOrEmpty(request.downloadHandler.text))
                        parsed = JsonConvert.DeserializeObject<LoginResponse>(request.downloadHandler.text);
                }
                catch (JsonException exception)
                {
                    onDone?.Invoke(false, "Сервер вернул некорректный JSON: " + exception.Message);
                    yield break;
                }

                if (request.result != UnityWebRequest.Result.Success || parsed == null || !parsed.Ok
                    || string.IsNullOrEmpty(parsed.Token))
                {
                    onDone?.Invoke(false, parsed?.Error ?? request.error ?? "Регистрация не выполнена.");
                    yield break;
                }

                Token = parsed.Token;
                Characters = parsed.Characters ?? new List<CharacterSummary>();
                onDone?.Invoke(true, null);
            }
        }

        public IEnumerator RequestPasswordReset(string email, Action<bool, string> onDone)
        {
            string body = new JObject { ["email"] = email ?? string.Empty }.ToString(Formatting.None);
            yield return SendPublicAction("/api/auth/password-reset/request", body, onDone);
        }

        public IEnumerator ConfirmPasswordReset(string login, string resetToken, string password,
                                                Action<bool, string> onDone)
        {
            string body = new JObject
            {
                ["login"] = login ?? string.Empty,
                ["token"] = resetToken ?? string.Empty,
                ["password"] = password ?? string.Empty
            }.ToString(Formatting.None);
            yield return SendPublicAction("/api/auth/password-reset/confirm", body, onDone);
        }

        public IEnumerator Heartbeat(Action<bool, string> onDone = null)
        {
            if (!IsAuthenticated)
            {
                onDone?.Invoke(false, "Нет активной сессии аккаунта.");
                yield break;
            }

            using (UnityWebRequest request = MakeJsonRequest("/api/auth/heartbeat", "POST", "{}"))
            {
                yield return request.SendWebRequest();
                JObject response;
                string parseError;
                if (!TryParseResponse(request, out response, out parseError))
                {
                    onDone?.Invoke(false, parseError);
                    yield break;
                }
                bool ok = request.result == UnityWebRequest.Result.Success
                    && response["ok"]?.ToObject<bool>() == true;
                onDone?.Invoke(ok, ok ? null : (response["error"]?.ToString() ?? request.error ?? "Сессия аккаунта не продлена."));
            }
        }

        /// <summary>GET /api/characters — обновить список персонажей уже авторизованного аккаунта.</summary>
        public IEnumerator RefreshCharacters(Action<bool, string> onDone)
        {
            using (UnityWebRequest request = MakeJsonRequest("/api/characters", "GET", null))
            {
                yield return request.SendWebRequest();

                if (request.result != UnityWebRequest.Result.Success)
                {
                    onDone?.Invoke(false, request.error);
                    yield break;
                }

                try
                {
                    LoginResponse parsed = JsonConvert.DeserializeObject<LoginResponse>(request.downloadHandler.text);
                    Characters = parsed?.Characters ?? new List<CharacterSummary>();
                    onDone?.Invoke(true, null);
                }
                catch (JsonException error)
                {
                    onDone?.Invoke(false, error.Message);
                }
            }
        }

        /// <summary>
        /// GET /api/characters/:id after Socket.IO join. The lease is required by the
        /// server while the character is active. Unity uses the saved document for
        /// client-only presentation state which is intentionally absent from join.self.
        /// </summary>
        public IEnumerator FetchCharacterState(string characterId, string characterLeaseId,
                                               Action<bool, JObject, string> onDone)
        {
            if (!IsAuthenticated || string.IsNullOrEmpty(characterId) || string.IsNullOrEmpty(characterLeaseId))
            {
                onDone?.Invoke(false, null, "Нет активной сессии персонажа.");
                yield break;
            }

            string path = "/api/characters/" + UnityWebRequest.EscapeURL(characterId);
            using (UnityWebRequest request = MakeJsonRequest(path, "GET", null, characterLeaseId))
            {
                yield return request.SendWebRequest();

                JObject response;
                string parseError;
                if (!TryParseResponse(request, out response, out parseError))
                {
                    onDone?.Invoke(false, null, parseError);
                    yield break;
                }

                JObject state = response["save"] as JObject;
                if (request.result != UnityWebRequest.Result.Success || response["ok"]?.ToObject<bool>() != true || state == null)
                {
                    onDone?.Invoke(false, null, response["error"]?.ToString() ?? request.error ?? "Сохранение персонажа не получено.");
                    yield break;
                }

                onDone?.Invoke(true, (JObject)state.DeepClone(), null);
            }
        }

        /// <summary>
        /// Persists eight client quick-access references through the existing save
        /// contract. A fresh document is fetched first; saveCharacterState then merges
        /// the live authoritative player over it on the server.
        /// </summary>
        public IEnumerator SaveQuickbar(string characterId, string characterLeaseId,
                                        IReadOnlyList<string> slots, Action<bool, string> onDone)
        {
            JObject state = null;
            string loadError = null;
            yield return FetchCharacterState(characterId, characterLeaseId, (ok, loaded, error) =>
            {
                if (ok) state = loaded;
                else loadError = error;
            });

            if (state == null)
            {
                onDone?.Invoke(false, loadError ?? "Не удалось получить сохранение персонажа.");
                yield break;
            }

            var serializedSlots = new JArray();
            int count = slots != null ? Mathf.Min(8, slots.Count) : 0;
            for (int i = 0; i < 8; i++)
            {
                string id = i < count ? (slots[i] ?? string.Empty).Trim() : string.Empty;
                serializedSlots.Add(string.IsNullOrEmpty(id) ? JValue.CreateNull() : new JValue(id));
            }
            state["quickbarSlots"] = serializedSlots;

            var body = new JObject
            {
                ["state"] = state,
                ["characterLeaseId"] = characterLeaseId,
                ["clientInstanceId"] = ClientInstanceId
            }.ToString(Formatting.None);

            string path = "/api/characters/" + UnityWebRequest.EscapeURL(characterId) + "/save";
            using (UnityWebRequest request = MakeJsonRequest(path, "POST", body, characterLeaseId))
            {
                yield return request.SendWebRequest();

                JObject response;
                string parseError;
                if (!TryParseResponse(request, out response, out parseError))
                {
                    onDone?.Invoke(false, parseError);
                    yield break;
                }

                bool ok = request.result == UnityWebRequest.Result.Success
                    && response["ok"]?.ToObject<bool>() == true;
                onDone?.Invoke(ok, ok ? null : (response["error"]?.ToString() ?? request.error ?? "Быстрые слоты не сохранены."));
            }
        }

        public IEnumerator DeleteCharacter(string characterId, Action<bool, string> onDone)
        {
            if (!IsAuthenticated || string.IsNullOrEmpty(characterId))
            {
                onDone?.Invoke(false, "Персонаж не выбран.");
                yield break;
            }
            string body = new JObject { ["confirmCharacterId"] = characterId }.ToString(Formatting.None);
            string path = "/api/characters/" + UnityWebRequest.EscapeURL(characterId);
            using (UnityWebRequest request = MakeJsonRequest(path, "DELETE", body))
            {
                yield return request.SendWebRequest();
                JObject response;
                string parseError;
                if (!TryParseResponse(request, out response, out parseError))
                {
                    onDone?.Invoke(false, parseError);
                    yield break;
                }
                bool ok = request.result == UnityWebRequest.Result.Success
                    && response["ok"]?.ToObject<bool>() == true;
                onDone?.Invoke(ok, ok ? null : (response["error"]?.ToString() ?? request.error ?? "Персонаж не удалён."));
            }
        }

        /// <summary>
        /// POST /api/auth/logout. Освобождает серверную блокировку аккаунта сразу,
        /// не дожидаясь истечения SESSION_LOCK_MS (по умолчанию 120 секунд).
        /// </summary>
        public IEnumerator Logout()
        {
            if (!IsAuthenticated) yield break;

            using (UnityWebRequest request = MakeJsonRequest("/api/auth/logout", "POST", "{}"))
            {
                yield return request.SendWebRequest();
            }

            Token = string.Empty;
            Characters = new List<CharacterSummary>();
        }

        /// <summary>Собирает запрос со всеми заголовками сессии из AUTH_AND_CHARACTERS.md.</summary>
        private UnityWebRequest MakeJsonRequest(string path, string method, string body,
                                                string characterLeaseId = null)
        {
            var request = new UnityWebRequest(_baseUrl + path, method);
            request.downloadHandler = new DownloadHandlerBuffer();

            if (!string.IsNullOrEmpty(body))
            {
                byte[] payload = System.Text.Encoding.UTF8.GetBytes(body);
                request.uploadHandler = new UploadHandlerRaw(payload);
                request.SetRequestHeader("Content-Type", "application/json");
            }

            request.SetRequestHeader("Accept", "application/json");
            request.SetRequestHeader("X-Device-Id", DeviceId);
            request.SetRequestHeader("X-Client-Instance-Id", ClientInstanceId);
            request.SetRequestHeader("X-Device-Type", DeviceType);
            request.SetRequestHeader("X-Control-Type", ControlType);
            if (!string.IsNullOrEmpty(characterLeaseId))
                request.SetRequestHeader("X-Character-Lease-Id", characterLeaseId);

            if (IsAuthenticated)
                request.SetRequestHeader("Authorization", "Bearer " + Token);

            return request;
        }

        private static bool TryParseResponse(UnityWebRequest request, out JObject response, out string error)
        {
            response = null;
            error = null;
            try
            {
                if (!string.IsNullOrEmpty(request.downloadHandler?.text))
                    response = JObject.Parse(request.downloadHandler.text);
            }
            catch (JsonException exception)
            {
                error = "Сервер вернул некорректный JSON: " + exception.Message;
                return false;
            }

            if (response == null)
            {
                error = request.error ?? "Сервер вернул пустой ответ.";
                return false;
            }
            return true;
        }

        private IEnumerator SendPublicAction(string path, string body, Action<bool, string> onDone)
        {
            using (UnityWebRequest request = MakeJsonRequest(path, "POST", body))
            {
                yield return request.SendWebRequest();
                JObject response;
                string parseError;
                if (!TryParseResponse(request, out response, out parseError))
                {
                    onDone?.Invoke(false, parseError);
                    yield break;
                }
                bool ok = request.result == UnityWebRequest.Result.Success
                    && response["ok"]?.ToObject<bool>() == true;
                string message = ok
                    ? (response["message"]?.ToString() ?? string.Empty)
                    : (response["error"]?.ToString() ?? request.error ?? "Запрос отклонён.");
                onDone?.Invoke(ok, message);
            }
        }
    }
}
