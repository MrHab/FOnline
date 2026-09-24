using System;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.Game
{
    /// <summary>Loopback-only visual QA using production loaders, without accounts or server writes.</summary>
    [DefaultExecutionOrder(10000)]
    public sealed class RoaLocalModelReview : MonoBehaviour
    {
        private static readonly string[] Bodies={"male_medium","female_medium"};
        private static readonly string[] Armors={"none","leather","metalArmor","ballisticVest","combatArmor","heavyArmor","hazmatSuit","energySuit"};
        private static readonly string[] Boots={"none","boots","scoutBoots","reinforcedBoots","assaultBoots"};
        private static readonly string[] Helmets={"none","helmet","tacticalHelmet","assaultHelmet","preWarHelmet","weldedHelmet"};
        private static readonly string[] Weapons={"pistol","rifle","assaultRifle","machineGun","laserPistol","flamethrower","plasmaRifle","shotgun","rocketLauncher","revolver","sawedOffShotgun","smg","knife","pickaxe","axe","handPump","medkit"};
        private static readonly string[] Offhands={"none","pistol","revolver","sawedOffShotgun","laserPistol","polygonRevolver02","polygonFlareGun01","knife","medkit"};
        private static readonly string[] Items={"medkit","blue","artifactDetectorMk1","artifactDetectorMk2","artifactDetectorMk3","artifactBelt2","artifactBelt3","artifactBelt4","artifactContainer","artifactSpring","artifactVein","artifactNode","artifactDrop","artifactBloodkin","artifactShell","artifactWarmer","artifactSieve","artifactThunderer","artifactHusher","artifactAnchor","artifactDew","artifactMemory","artifactUnknown"};
        private string _origin, _status="Загрузка…";
        private int _body=0, _armor=7, _boots=4, _helmet=2, _tier=2, _weapon, _offhand, _item, _request;
        private float _angle;
        private bool _itemMode, _dead;
        private RoaCharacterPreview _preview;
        private RoaCharacterView _character;
        private Camera _camera;
        private Vector3 _cameraPosition;
        private Quaternion _cameraRotation;
        private GameObject _itemRoot;
        private bool _feetCloseup;

        public static bool AcceptsUrl(string url)
        {
            return Uri.TryCreate(url,UriKind.Absolute,out Uri uri) && uri.IsLoopback
                && (uri.Scheme==Uri.UriSchemeHttp || uri.Scheme==Uri.UriSchemeHttps)
                && uri.Query.TrimStart('?').Split('&').Contains("roaModelReview=1");
        }

        public static bool TryStart()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            if(!AcceptsUrl(Application.absoluteURL)) return false;
            var host=new GameObject("LocalModelReview");
            host.AddComponent<RoaLocalModelReview>()._origin=new Uri(Application.absoluteURL).GetLeftPart(UriPartial.Authority);
            // Never initialize authentication, multiplayer, saves or normal gameplay
            // while previewing synthetic equipment combinations.
            foreach(var root in SceneManager.GetActiveScene().GetRootGameObjects())
                if(root!=host) root.SetActive(false);
            return true;
#else
            return false;
#endif
        }

        private void Start()
        {
            _preview=gameObject.AddComponent<RoaCharacterPreview>();
            _=Apply();
        }

        private async Task Apply()
        {
            int request=++_request;
            _status="Загрузка моделей…";
            if(_itemRoot!=null) { _itemRoot.SetActive(false); Destroy(_itemRoot); _itemRoot=null; }
            string body=Bodies[_body];
            _preview.Show(_origin,new CharacterAppearance { Sex=body.Split('_')[0],HairId="short_crop",HairColorId="hair_08" },640,640);
            transform.Find("CharacterPreviewScene").position=Vector3.zero;
            float deadline=Time.realtimeSinceStartup+60;
            while(!_preview.IsReady || _preview.RequestedModelKey!=body)
            {
                if(this==null || request!=_request) return;
                if(Time.realtimeSinceStartup>deadline) { _status="Ошибка загрузки тела"; return; }
                await Task.Yield();
            }
            if(this==null || request!=_request) return;
            _character=GetComponentInChildren<RoaCharacterView>(true);
            if(_camera==null)
            {
                _camera=GetComponentInChildren<Camera>(true);
                _cameraPosition=_camera.transform.localPosition;
                _cameraRotation=_camera.transform.localRotation;
            }
            _character.gameObject.SetActive(true);
            _character.SetDead(false); _dead=false;
            if(!RoaOffhandWeaponView.CanRender(Weapons[_weapon])) _offhand=0;
            var outfit=new JObject { ["armor"]=_armor==0?"":Armors[_armor], ["boots"]=_boots==0?"":Boots[_boots],
                ["helmet"]=_helmet==0?"":Helmets[_helmet], ["backpack"]="backpack",
                ["offhand"]=_offhand==0?"":Offhands[_offhand],
                ["detector"]="artifactDetectorMk"+(_tier+1), ["artifactBelt"]="artifactBelt"+(_tier+2) };
            await Task.WhenAll(_character.EquipItems(_origin,outfit),_character.EquipWeapon(_origin,Weapons[_weapon]));
            if(this==null || request!=_request) return;
            SetCharacterCamera();
            if(_itemMode)
            {
                GameObject candidate=await RoaItemModelCatalog.InstantiateInactive(_origin,Items[_item],transform.Find("CharacterPreviewScene"));
                if(this==null || request!=_request) { if(candidate!=null) Destroy(candidate); return; }
                if(candidate==null) { _status="Ошибка загрузки предмета"; return; }
                _itemRoot=candidate;
                candidate.transform.localPosition=Vector3.up*.9f;
                candidate.SetActive(true);
                _character.gameObject.SetActive(false);
                var renderers=candidate.GetComponentsInChildren<Renderer>();
                Bounds bounds=renderers[0].bounds;
                foreach(var renderer in renderers) bounds.Encapsulate(renderer.bounds);
                _camera.transform.position=bounds.center+new Vector3(1.3f,.9f,2f).normalized*Mathf.Max(.55f,bounds.size.magnitude*2);
                _camera.transform.LookAt(bounds.center);
            }
            foreach(var node in GetComponentsInChildren<Transform>(true)) node.gameObject.layer=RoaCharacterPreview.PreviewLayer;
            int expected=3+(_armor>0?1:0)+(_boots>0?1:0)+(_helmet>0?1:0);
            _status=_itemMode ? "Готово: "+Items[_item] : _character.LoadedEquipmentSlotCount==expected && _character.WeaponReady
                && (_offhand==0 || _character.OffhandWeaponReady)
                ? "Готово: "+body+"; слотов "+expected : "Не все модели загрузились";
            Debug.Log("[ROA MODEL REVIEW] "+_status+"; suits="+RoaSuitModelCatalog.CatalogVersion+"; utilities="+RoaWornUtilityCatalog.CatalogVersion);
        }

        private void SetCharacterCamera()
        {
            if(_camera==null || _character==null) return;
            _camera.transform.localPosition=_feetCloseup ? new Vector3(-.85f,.50f,-1.25f) : _cameraPosition;
            _camera.transform.localRotation=_cameraRotation;
            if(_feetCloseup) _camera.transform.LookAt(_character.transform.position+Vector3.up*.23f);
            _preview.FieldOfView=_feetCloseup ? 35 : 38;
        }

        private void LateUpdate()
        {
            if(_character!=null && !_itemMode) _character.transform.localRotation=Quaternion.Euler(0,_angle,0);
            if(_itemRoot!=null) _itemRoot.transform.localRotation=Quaternion.Euler(0,_angle,0);
            if(_preview!=null) _preview.RenderNow();
        }

        private void OnGUI()
        {
            GUI.depth=-10000;
            GUI.DrawTexture(new Rect(0,0,Screen.width,Screen.height),Texture2D.blackTexture);
            float scale=Mathf.Min(Screen.width/1280f,Screen.height/720f);
            Matrix4x4 saved=GUI.matrix;
            GUI.matrix=Matrix4x4.TRS(new Vector3((Screen.width-1280*scale)*.5f,(Screen.height-720*scale)*.5f,0),Quaternion.identity,Vector3.one*scale);
            // WebGL has no OS fallback for the default IMGUI font's missing Cyrillic glyphs.
            var label=new GUIStyle(GUI.skin.label) {font=RoaUiFont.Default,fontSize=20,wordWrap=true};
            var button=new GUIStyle(GUI.skin.button) {font=RoaUiFont.Default,fontSize=18};
            GUI.Label(new Rect(20,10,1240,40),"ЛОКАЛЬНАЯ ПРИМЕРКА • без аккаунта и сохранений",label);
            if(_preview!=null && _preview.Texture!=null) GUI.DrawTexture(new Rect(365,65,885,600),_preview.Texture,ScaleMode.ScaleToFit,false);
            int row=0;
            bool Button(string text) => GUI.Button(new Rect(20,65+row++*45,325,39),text,button);
            if(Button(_itemMode?"Режим: предмет на земле":"Режим: на персонаже")) { _itemMode=!_itemMode; _=Apply(); }
            if(Button("Тело: "+Bodies[_body])) { _body=(_body+1)%Bodies.Length; _=Apply(); }
            if(Button("Броня: "+Armors[_armor])) { _armor=(_armor+1)%Armors.Length; _=Apply(); }
            if(Button("Обувь: "+Boots[_boots])) { _boots=(_boots+1)%Boots.Length; _=Apply(); }
            if(Button("Шлем: "+Helmets[_helmet])) { _helmet=(_helmet+1)%Helmets.Length; _=Apply(); }
            if(Button("Детектор / пояс: "+(_tier+1)+" / "+(_tier+2))) { _tier=(_tier+1)%3; _=Apply(); }
            if(Button("Оружие: "+Weapons[_weapon])) { _weapon=(_weapon+1)%Weapons.Length; _=Apply(); }
            bool freeHand=RoaOffhandWeaponView.CanRender(Weapons[_weapon]);
            if(Button(freeHand?"Вторая рука: "+Offhands[_offhand]:"Вторая рука занята оружием") && freeHand)
            { _offhand=(_offhand+1)%Offhands.Length; _=Apply(); }
            if(Button("Предмет: "+Items[_item])) { _item=(_item+1)%Items.Length; _itemMode=true; _=Apply(); }
            if(Button("Повернуть на 45°")) _angle+=45;
            if(Button("Атака") && _character!=null) _character.PlayAttack();
            if(Button("Перезарядка") && _character!=null) _character.StartReload(1.5f);
            if(Button("Смерть / встать") && _character!=null) { _dead=!_dead; _character.SetDead(_dead); }
            if(Button(_feetCloseup?"Камера: ноги крупно":"Камера: полный рост") && !_itemMode)
            { _feetCloseup=!_feetCloseup; SetCharacterCamera(); }
            GUI.Label(new Rect(365,655,885,35),_status,label);
            GUI.Label(new Rect(20,690,1240,26),"suits "+RoaSuitModelCatalog.CatalogVersion+" | gear "+RoaEquipmentModelCatalog.CatalogVersion+" | utilities "+RoaWornUtilityCatalog.CatalogVersion+" | items "+RoaItemModelCatalog.CatalogVersion,label);
            GUI.matrix=saved;
        }

        private void OnDestroy() { ++_request; }
    }
}
