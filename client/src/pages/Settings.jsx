import Permissions from "../components/Permissions";
import Preferences from "../components/Preferences";
import BillingPanel from "../components/BillingPanel";
import LearningHub from "../components/LearningHub";
import AssistantHub from "../components/AssistantHub";
import CommunicationsCenter from "../components/CommunicationsCenter";

export default function Settings() {
  return (
    <div className="min-h-screen bg-gray-950 text-white px-4 py-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-sm text-gray-400 mt-2">Manage Dex billing, permissions, and voice preferences.</p>
        </div>
        <BillingPanel />
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <AssistantHub />
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <CommunicationsCenter />
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <LearningHub />
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <Permissions />
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <Preferences />
        </div>
      </div>
    </div>
  );
}
