import { Fragment, useEffect, useState } from "react";
import { api, type StaffUser } from "../api/client";

const PERMISSION_LABELS: Record<string, string> = {
  gun_sonu: "Gün Sonu",
  dashboard: "Yönetici Dashboard",
  musteriler: "Müşteriler",
};

const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS);

interface EditForm {
  username: string;
  password: string;
  isAdmin: boolean;
  permissions: string[];
}

export default function Kullanicilar() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [hata, setHata] = useState<string | null>(null);
  const [basari, setBasari] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [olusturuluyor, setOlusturuluyor] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  async function refresh() {
    setYukleniyor(true);
    setHata(null);
    try {
      setUsers(await api.listUsers());
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setYukleniyor(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function togglePermission(perm: string) {
    setPermissions((prev) => (prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]));
  }

  async function hesapOlustur() {
    setHata(null);
    setBasari(null);
    setOlusturuluyor(true);
    try {
      await api.createUser(username, password, isAdmin, isAdmin ? [] : permissions);
      setBasari(`"${username}" hesabı oluşturuldu.`);
      setUsername("");
      setPassword("");
      setIsAdmin(false);
      setPermissions([]);
      await refresh();
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setOlusturuluyor(false);
    }
  }

  async function hesapSil(id: number, kullaniciAdi: string) {
    setHata(null);
    setBasari(null);
    try {
      await api.deleteUser(id);
      setBasari(`"${kullaniciAdi}" hesabı silindi.`);
      await refresh();
    } catch (e) {
      setHata((e as Error).message);
    }
  }

  // TOTP sıfırlama: telefon kaybı/değişimi gibi durumlarda kullanıcının
  // yeniden QR kod okutup kurulum yapabilmesi için mevcut kaydı siler.
  async function totpSifirla(id: number, kullaniciAdi: string) {
    setHata(null);
    setBasari(null);
    try {
      await api.resetUserTotp(id);
      setBasari(`"${kullaniciAdi}" için TOTP sıfırlandı; bir sonraki girişte yeniden kurulum yapacak.`);
      await refresh();
    } catch (e) {
      setHata((e as Error).message);
    }
  }

  function duzenlemeyeBasla(u: StaffUser) {
    setHata(null);
    setBasari(null);
    setEditingId(u.id);
    setEditForm({
      username: u.username,
      password: "",
      isAdmin: u.is_admin,
      permissions: [...u.permissions],
    });
  }

  function duzenlemeyiIptalEt() {
    setEditingId(null);
    setEditForm(null);
  }

  function toggleEditPermission(perm: string) {
    setEditForm((prev) =>
      prev
        ? { ...prev, permissions: prev.permissions.includes(perm) ? prev.permissions.filter((p) => p !== perm) : [...prev.permissions, perm] }
        : prev
    );
  }

  async function duzenlemeyiKaydet() {
    if (editingId == null || !editForm) return;
    setHata(null);
    setBasari(null);
    setKaydediliyor(true);
    try {
      await api.updateUser(
        editingId,
        editForm.username,
        editForm.password.trim() === "" ? null : editForm.password,
        editForm.isAdmin,
        editForm.isAdmin ? [] : editForm.permissions
      );
      setBasari(`"${editForm.username}" hesabı güncellendi.`);
      duzenlemeyiIptalEt();
      await refresh();
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setKaydediliyor(false);
    }
  }

  return (
    <div className="page">
      <h1>Kullanıcı Yönetimi</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Personel hesapları oluşturun, düzenleyin ve hangi ekranlara erişebileceklerini belirleyin.
      </p>

      {hata && <div className="alert alert--error">{hata}</div>}
      {basari && <div className="alert alert--success">{basari}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Yeni Hesap Oluştur</h2>
        <div className="field-row" style={{ marginBottom: 12 }}>
          <div className="field">
            <label>Kullanıcı Adı</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="field">
            <label>Şifre (en az 6 karakter)</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
            Yönetici (tüm ekranlar + fiyat kuralları + kullanıcı yönetimi)
          </label>
        </div>

        {!isAdmin && (
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Erişebileceği Ekranlar</label>
            <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
              {ALL_PERMISSIONS.map((perm) => (
                <label key={perm} style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
                  <input
                    type="checkbox"
                    checked={permissions.includes(perm)}
                    onChange={() => togglePermission(perm)}
                  />
                  {PERMISSION_LABELS[perm]}
                </label>
              ))}
            </div>
          </div>
        )}

        <button onClick={hesapOlustur} disabled={olusturuluyor || !username || password.length < 6}>
          {olusturuluyor ? "Oluşturuluyor..." : "Hesap Oluştur"}
        </button>
      </div>

      <div className="card">
        <h2>Mevcut Hesaplar ({users.length})</h2>
        {yukleniyor && <p className="muted">Yükleniyor...</p>}
        {!yukleniyor && (
          <table>
            <thead>
              <tr>
                <th>Kullanıcı Adı</th>
                <th>Yetki</th>
                <th>TOTP</th>
                <th>Oluşturulma</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <Fragment key={u.id}>
                  <tr>
                    <td>{u.username}</td>
                    <td>
                      {u.is_admin ? (
                        <span className="badge badge--kart">Yönetici</span>
                      ) : u.permissions.length === 0 ? (
                        <span className="muted">Sadece Kasa Ekranı</span>
                      ) : (
                        u.permissions.map((p) => (
                          <span key={p} className="badge badge--nakit" style={{ marginRight: 4 }}>
                            {PERMISSION_LABELS[p] ?? p}
                          </span>
                        ))
                      )}
                    </td>
                    <td>
                      {u.totp_enabled ? (
                        <span className="badge badge--nakit">Kurulu</span>
                      ) : (
                        <span className="muted">Kurulmadı</span>
                      )}
                    </td>
                    <td>{u.created_at}</td>
                    <td>
                      {editingId === u.id ? (
                        <button className="ghost" onClick={duzenlemeyiIptalEt}>İptal</button>
                      ) : (
                        <>
                          <button className="ghost" onClick={() => duzenlemeyeBasla(u)}>Düzenle</button>{" "}
                          {u.totp_enabled && (
                            <>
                              <button className="ghost" onClick={() => totpSifirla(u.id, u.username)}>TOTP Sıfırla</button>{" "}
                            </>
                          )}
                          <button className="ghost" onClick={() => hesapSil(u.id, u.username)}>Sil</button>
                        </>
                      )}
                    </td>
                  </tr>
                  {editingId === u.id && editForm && (
                    <tr>
                      <td colSpan={5} style={{ background: "var(--cream-soft)" }}>
                        <div className="field-row" style={{ marginBottom: 12 }}>
                          <div className="field">
                            <label>Kullanıcı Adı</label>
                            <input
                              value={editForm.username}
                              onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
                            />
                          </div>
                          <div className="field">
                            <label>Yeni Şifre (boş bırakılırsa değişmez)</label>
                            <input
                              type="password"
                              value={editForm.password}
                              onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                            />
                          </div>
                        </div>

                        <div className="field" style={{ marginBottom: 12 }}>
                          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={editForm.isAdmin}
                              onChange={(e) => setEditForm({ ...editForm, isAdmin: e.target.checked })}
                            />
                            Yönetici (tüm ekranlar + fiyat kuralları + kullanıcı yönetimi)
                          </label>
                        </div>

                        {!editForm.isAdmin && (
                          <div className="field" style={{ marginBottom: 12 }}>
                            <label>Erişebileceği Ekranlar</label>
                            <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
                              {ALL_PERMISSIONS.map((perm) => (
                                <label key={perm} style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
                                  <input
                                    type="checkbox"
                                    checked={editForm.permissions.includes(perm)}
                                    onChange={() => toggleEditPermission(perm)}
                                  />
                                  {PERMISSION_LABELS[perm]}
                                </label>
                              ))}
                            </div>
                          </div>
                        )}

                        <button onClick={duzenlemeyiKaydet} disabled={kaydediliyor || !editForm.username}>
                          {kaydediliyor ? "Kaydediliyor..." : "Kaydet"}
                        </button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
