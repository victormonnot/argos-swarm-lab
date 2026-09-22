// Evaluator only. No world pose, distances or contacts enter mission decisions.
#include <array>
#include <chrono>
#include <iomanip>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <gz/plugin/Register.hh>
#include <gz/sim/System.hh>
#include <gz/sim/Link.hh>
#include <gz/sim/Util.hh>
#include <gz/sim/components/Collision.hh>
#include <gz/sim/components/ContactSensorData.hh>
#include <gz/transport/Node.hh>
#include <gz/msgs/stringmsg.pb.h>

class SharedWorldObserver final : public gz::sim::System,
 public gz::sim::ISystemConfigure, public gz::sim::ISystemPreUpdate,
 public gz::sim::ISystemPostUpdate {
 using Pair=std::pair<std::string,std::string>;
 struct Contact { std::string kind; unsigned long steps=0; double first=0,last=0; };
 gz::transport::Node node;
 gz::transport::Node::Publisher publisher;
 std::array<gz::sim::Link,3> measured;
 std::map<gz::sim::Entity,std::string> collisionNames;
 std::map<Pair,Contact> history;
 std::map<std::string,unsigned long> totals{{"ground",0},{"obstacle",0},{"vehicle",0},{"other",0}};
 unsigned long steps=0;
 double lastPublished=-1, observerStart=-1;
 static std::string vehicle(const std::string &name) {
  for(const auto &id:{"A1","A2","A3"}) if(name.rfind(std::string(id)+"::",0)==0) return id;
  return "";
 }
 static std::string classify(const Pair &pair) {
  const auto a=vehicle(pair.first), b=vehicle(pair.second);
  if(a.empty() && b.empty()) return "other";
  if(pair.first=="ground::ground::surface" || pair.second=="ground::ground::surface") return "ground";
  if(!a.empty() && !b.empty() && a!=b) return "vehicle";
  for(const auto &building:{"west_store::","east_store::","north_store::"})
   if(pair.first.rfind(building,0)==0 || pair.second.rfind(building,0)==0) return "obstacle";
  return "other";
 }
 public: void Configure(const gz::sim::Entity &, const std::shared_ptr<const sdf::Element> &,
  gz::sim::EntityComponentManager &, gz::sim::EventManager &) override {
  publisher=node.Advertise<gz::msgs::StringMsg>("/argos/shared-world");
 }
 public: void PreUpdate(const gz::sim::UpdateInfo &info, gz::sim::EntityComponentManager &ecm) override {
  if(info.paused) return;
  for(unsigned i=0;i<measured.size();++i) if(!measured[i].Valid(ecm)) {
   auto found=gz::sim::entitiesFromScopedName("A"+std::to_string(i+1)+"::iris_with_standoffs::imu_link",ecm);
   if(found.size()!=1) return;
   measured[i]=gz::sim::Link(*found.begin()); measured[i].EnableVelocityChecks(ecm);
  }
  ecm.Each<gz::sim::components::Collision>([&](const gz::sim::Entity &entity,
    const gz::sim::components::Collision *) {
   if(collisionNames.count(entity)) return true;
   collisionNames[entity]=gz::sim::removeParentScope(gz::sim::scopedName(entity,ecm,"::",false),"::");
   if(!ecm.Component<gz::sim::components::ContactSensorData>(entity))
    ecm.CreateComponent(entity,gz::sim::components::ContactSensorData());
   return true;
  });
 }
 public: void PostUpdate(const gz::sim::UpdateInfo &info, const gz::sim::EntityComponentManager &ecm) override {
  if(info.paused) return;
  for(const auto &link:measured) if(!link.Valid(ecm) || !link.WorldPose(ecm) || !link.WorldLinearVelocity(ecm)) return;
  const double now=std::chrono::duration<double>(info.simTime).count()*1000;
  if(observerStart<0) observerStart=now;
  ++steps;
  std::set<Pair> active;
  ecm.Each<gz::sim::components::Collision,gz::sim::components::ContactSensorData>(
   [&](const gz::sim::Entity &,const gz::sim::components::Collision *,const gz::sim::components::ContactSensorData *data) {
    for(const auto &contact:data->Data().contact()) {
     auto a=collisionNames.find(contact.collision1().id()),b=collisionNames.find(contact.collision2().id());
     if(a==collisionNames.end() || b==collisionNames.end()) continue;
     active.insert(std::minmax(a->second,b->second));
    }
    return true;
   });
  std::set<std::string> kinds;
  for(const auto &pair:active) {
   auto &entry=history[pair];
   if(entry.steps==0) { entry.kind=classify(pair); entry.first=now; }
   ++entry.steps; entry.last=now; kinds.insert(entry.kind);
  }
  for(const auto &kind:kinds) ++totals[kind];
  if(now-lastPublished<50-1e-6) return;
  lastPublished=now;
  std::ostringstream json; json<<std::setprecision(12)<<"{\"simTimeMs\":"<<now
   <<",\"observerStartSimTimeMs\":"<<observerStart<<",\"observerSteps\":"<<steps
   <<",\"collisionCount\":"<<collisionNames.size()<<",\"vehicles\":[";
  for(unsigned i=0;i<measured.size();++i) {
   const auto pose=*measured[i].WorldPose(ecm); const auto velocity=*measured[i].WorldLinearVelocity(ecm);
   const auto &p=pose.Pos();const auto &q=pose.Rot();const auto &v=velocity;
   if(i) json<<",";
   json<<"{\"id\":\"A"<<i+1<<"\",\"positionEnu\":["<<p.X()<<","<<p.Y()<<","<<p.Z()
    <<"],\"orientationXyzw\":["<<q.X()<<","<<q.Y()<<","<<q.Z()<<","<<q.W()
    <<"],\"velocityEnu\":["<<v.X()<<","<<v.Y()<<","<<v.Z()<<"]}";
  }
  json<<"],\"collisionNames\":["; bool comma=false; std::set<std::string> sortedNames;
  for(const auto &[entity,name]:collisionNames) sortedNames.insert(name);
  for(const auto &name:sortedNames) { if(comma) json<<",";comma=true;json<<"\""<<name<<"\""; }
  json<<"],\"contactTotals\":{"; comma=false;
  for(const auto &[kind,count]:totals) { if(comma) json<<",";comma=true;json<<"\""<<kind<<"Steps\":"<<count; }
  json<<"},\"contacts\":[";comma=false;
  for(const auto &pair:active) { if(comma) json<<",";comma=true;
   json<<"{\"collision1\":\""<<pair.first<<"\",\"collision2\":\""<<pair.second<<"\",\"kind\":\""<<classify(pair)<<"\"}"; }
  json<<"],\"contactHistory\":[";comma=false;
  for(const auto &[pair,entry]:history) { if(comma) json<<",";comma=true;
   json<<"{\"collision1\":\""<<pair.first<<"\",\"collision2\":\""<<pair.second<<"\",\"kind\":\""<<entry.kind
    <<"\",\"steps\":"<<entry.steps<<",\"firstSimTimeMs\":"<<entry.first<<",\"lastSimTimeMs\":"<<entry.last<<"}"; }
  json<<"]}";
  gz::msgs::StringMsg message;message.set_data(json.str());publisher.Publish(message);
 }
};
GZ_ADD_PLUGIN(SharedWorldObserver,gz::sim::System,SharedWorldObserver::ISystemConfigure,
 SharedWorldObserver::ISystemPreUpdate,SharedWorldObserver::ISystemPostUpdate)
