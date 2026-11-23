
            <div className="settings-section">
              <h3><UserRound size={17} /> Edit Profile</h3>

              <label>
                Display name
                <input
                  className="profile-name-input"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  maxLength={40}
                  placeholder="Your display name"
                />
              </label>

              <button
                className="upload-avatar"
                onClick={saveDisplayName}
              >
                <Check size={15} style={{ verticalAlign: 'middle' }} />
                {' '}Save Profile
              </button>
            </div>

            <div className="settings-section">
              <h3><UserRound size={17} /> Your Avatar</h3>

              <div className="avatar-preview">
                <Avatar
                  profile={myProfile}
                  label={currentDisplayName}
                  size="large"
                />

                <div>
                  <b>{currentDisplayName}</b>

                  <p className="muted" style={{ margin: '5px 0 9px' }}>
                    Choose your profile picture
                  </p>

                  <button
                    className="upload-avatar"
                    onClick={() => avatarInput.current?.click()}
                    disabled={avatarBusy}
                  >
                    <Camera size={15} style={{ verticalAlign: 'middle' }} />
                    {' '}
                    {avatarBusy ? 'Uploading...' : 'Upload Photo'}
                  </button>

                  <input
                    ref={avatarInput}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={e => {
                      uploadAvatar(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="settings-section">
              <h3><Palette size={17} /> Choose Theme</h3>

              <div className="settings-options">
                <button
                  className={`theme-option ${
                    theme === 'dark' ? 'selected' : ''
                  }`}
                  onClick={() => updateCustomization('theme', 'dark')}
                >
                  <Moon size={17} /> Dark
                  {theme === 'dark' && <Check size={15} />}
                </button>

                <button
                  className={`theme-option ${
                    theme === 'light' ? 'selected' : ''
                  }`}
                  onClick={() => updateCustomization('theme', 'light')}
                >
                  <Sun size={17} /> Light
                  {theme === 'light' && <Check size={15} />}
                </button>
              </div>
            </div>

            <div className="settings-section">
              <h3><Palette size={17} /> Accent Color</h3>

              <div className="settings-options">
                {Object.entries(ACCENTS).map(([key, color]) => (
                  <button
                    key={key}
                    className={`theme-option ${
                      accent === key ? 'selected' : ''
                    }`}
                    onClick={() =>
                      updateCustomization('accent_color', key)
                    }
                    title={key}
                  >
                    <span
                      className="color-dot"
                      style={{ background: color }}
                    />

                    {key[0].toUpperCase() + key.slice(1)}

                    {accent === key && <Check size={14} />}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-section">
              <h3><Bell size={17} /> Notifications</h3>

              <button
                className="notification-button"
                onClick={enableNotifications}
              >
                {notificationPermission === 'granted'
                  ? 'Notifications are enabled'
