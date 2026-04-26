import Permissions from "../components/Permissions";
import Preferences from "../components/Preferences";

export default function Settings() {
  return (
    <div className="settings-page">
      <h1>Settings</h1>
      <Permissions />
      <Preferences />
    </div>
  );
}