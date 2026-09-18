// Evaluator-only world truth and a bounded physical disturbance. No truth is sent to the controller.
#include <atomic>
#include <chrono>
#include <iomanip>
#include <sstream>
#include <gz/plugin/Register.hh>
#include <gz/sim/System.hh>
#include <gz/sim/Link.hh>
#include <gz/sim/Util.hh>
#include <gz/transport/Node.hh>
#include <gz/msgs/boolean.pb.h>
#include <gz/msgs/stringmsg.pb.h>

class TruthObserver final : public gz::sim::System,
 public gz::sim::ISystemConfigure, public gz::sim::ISystemPreUpdate,
 public gz::sim::ISystemPostUpdate {
 gz::transport::Node node;
 gz::transport::Node::Publisher publisher;
 gz::sim::Link measured, pushed;
 std::atomic<bool> requested{false};
 bool started=false, active=false, previousActive=false;
 double start=-1, elapsed=0, lastPublished=-1, impulse=0;
 unsigned long steps=0;
 public: void Configure(const gz::sim::Entity &, const std::shared_ptr<const sdf::Element> &,
  gz::sim::EntityComponentManager &, gz::sim::EventManager &) override {
  publisher=node.Advertise<gz::msgs::StringMsg>("/argos/truth");
  node.Subscribe("/argos/pulse", &TruthObserver::Request, this);
 }
 void Request(const gz::msgs::Boolean &request) { if(request.data()) requested.store(true); }
 public: void PreUpdate(const gz::sim::UpdateInfo &info, gz::sim::EntityComponentManager &ecm) override {
  if(info.paused) return;
  if(!measured.Valid(ecm)) {
   auto imu=gz::sim::entitiesFromScopedName("iris::iris_with_standoffs::imu_link",ecm);
   auto base=gz::sim::entitiesFromScopedName("iris::iris_with_standoffs::base_link",ecm);
   if(imu.size()!=1 || base.size()!=1) return;
   measured=gz::sim::Link(*imu.begin()); pushed=gz::sim::Link(*base.begin());
   measured.EnableVelocityChecks(ecm); pushed.EnableVelocityChecks(ecm);
  }
  const double now=std::chrono::duration<double>(info.simTime).count();
  if(requested.exchange(false) && !started) { started=true; start=now; }
  active=started && now-start < 1.0-1e-9;
  if(active) {
   pushed.AddWorldForce(ecm,gz::math::Vector3d(8,0,0));
   ++steps; impulse += 8*std::chrono::duration<double>(info.dt).count();
  }
 }
 public: void PostUpdate(const gz::sim::UpdateInfo &info, const gz::sim::EntityComponentManager &ecm) override {
  if(info.paused || !measured.Valid(ecm)) return;
  const double now=std::chrono::duration<double>(info.simTime).count();
  if(now-lastPublished<.05-1e-9 && active==previousActive) return;
  auto pose=measured.WorldPose(ecm); auto velocity=measured.WorldLinearVelocity(ecm);
  if(!pose || !velocity) return;
  lastPublished=now; previousActive=active;
  const auto &p=pose->Pos(); const auto &q=pose->Rot(); const auto &v=*velocity;
  std::ostringstream json; json<<std::setprecision(12)
   <<"{\"simTimeMs\":"<<now*1000<<",\"positionEnu\":["<<p.X()<<","<<p.Y()<<","<<p.Z()
   <<"],\"orientationXyzw\":["<<q.X()<<","<<q.Y()<<","<<q.Z()<<","<<q.W()
   <<"],\"velocityEnu\":["<<v.X()<<","<<v.Y()<<","<<v.Z()
   <<"],\"forceEnu\":["<<(active?8:0)<<",0,0],\"pulseActive\":"<<(active?"true":"false")
   <<",\"pulseAppliedSteps\":"<<steps<<",\"impulseNs\":["<<impulse<<",0,0]}";
  gz::msgs::StringMsg message;message.set_data(json.str());publisher.Publish(message);
 }
};
GZ_ADD_PLUGIN(TruthObserver,gz::sim::System,TruthObserver::ISystemConfigure,
 TruthObserver::ISystemPreUpdate,TruthObserver::ISystemPostUpdate)
